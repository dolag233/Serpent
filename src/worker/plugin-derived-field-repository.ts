import {
  namespacedDerivedFieldId,
  pluginProviderFieldTypeSchema,
  type PluginProviderFieldType,
} from '../plugins/plugin-providers';

type SqlConnection = {
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number };
    all(...params: unknown[]): unknown[];
  };
  transaction<T>(operation: () => T): (() => T);
};

type DerivedValue = string | number | boolean | null;

export type PluginDerivedFieldRow = {
  assetId: string;
  value: DerivedValue;
  updatedAt: string;
};

function encodeValue(value: DerivedValue, fieldType: PluginProviderFieldType): {
  text: string | null;
  number: number | null;
  bool: number | null;
  json: string | null;
} {
  switch (fieldType) {
    case 'number':
      if (typeof value !== 'number') throw new Error('Derived field value must be a number.');
      return { text: null, number: value, bool: null, json: null };
    case 'boolean':
      if (typeof value !== 'boolean') throw new Error('Derived field value must be a boolean.');
      return { text: null, number: null, bool: value ? 1 : 0, json: null };
    case 'json':
      return { text: null, number: null, bool: null, json: JSON.stringify(value) };
    case 'date':
    case 'string':
      if (value !== null && typeof value !== 'string') {
        throw new Error('Derived field value must be a string.');
      }
      return { text: value, number: null, bool: null, json: null };
  }
}

export function materializePluginDerivedFields(
  connection: SqlConnection,
  input: {
    libraryId: string;
    pluginId: string;
    packageHash: string;
    fieldId: string;
    fieldType: PluginProviderFieldType;
    values: ReadonlyArray<{ assetId: string; value: DerivedValue }>;
  },
): { writtenCount: number; fieldKey: string } {
  const fieldKey = namespacedDerivedFieldId(input.pluginId, input.fieldId);
  pluginProviderFieldTypeSchema.parse(input.fieldType);
  const now = new Date().toISOString();
  const write = connection.transaction(() => {
    connection.prepare(
      `DELETE FROM plugin_derived_fields
        WHERE library_id = ? AND plugin_id = ? AND field_id = ? AND package_hash <> ?`,
    ).run(input.libraryId, input.pluginId, input.fieldId, input.packageHash);
    const statement = connection.prepare(
      `INSERT INTO plugin_derived_fields (
         library_id, asset_id, plugin_id, package_hash, field_id, field_type,
         value_text, value_number, value_boolean, value_json, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(library_id, asset_id, plugin_id, package_hash, field_id)
       DO UPDATE SET
         field_type = excluded.field_type,
         value_text = excluded.value_text,
         value_number = excluded.value_number,
         value_boolean = excluded.value_boolean,
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`,
    );
    let writtenCount = 0;
    for (const entry of input.values) {
      const encoded = encodeValue(entry.value, input.fieldType);
      statement.run(
        input.libraryId,
        entry.assetId,
        input.pluginId,
        input.packageHash,
        input.fieldId,
        input.fieldType,
        encoded.text,
        encoded.number,
        encoded.bool,
        encoded.json,
        now,
      );
      writtenCount += 1;
    }
    return writtenCount;
  })();
  return { writtenCount: write, fieldKey };
}

export function queryPluginDerivedFields(
  connection: SqlConnection,
  input: {
    libraryId: string;
    pluginId: string;
    packageHash: string;
    fieldId: string;
    operator: 'equals' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte';
    value: DerivedValue;
    limit?: number;
    offset?: number;
  },
): { assetIds: string[]; total: number } {
  const rows = connection.prepare(
    `SELECT asset_id AS assetId
       FROM plugin_derived_fields
      WHERE library_id = ?
        AND plugin_id = ?
        AND package_hash = ?
        AND field_id = ?
        AND (
          (value_text IS NOT NULL AND value_text ${operatorSql(input.operator)} ?)
          OR (value_number IS NOT NULL AND value_number ${operatorSql(input.operator)} ?)
          OR (value_boolean IS NOT NULL AND value_boolean ${operatorSql(input.operator)} ?)
        )
      ORDER BY asset_id ASC`,
  ).all(
    input.libraryId,
    input.pluginId,
    input.packageHash,
    input.fieldId,
    comparisonValue(input),
    comparisonValue(input),
    comparisonValue(input),
  ) as Array<{ assetId: string }>;
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 256;
  return {
    assetIds: rows.slice(offset, offset + limit).map((row) => row.assetId),
    total: rows.length,
  };
}

function comparisonValue(input: {
  operator: 'equals' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte';
  value: DerivedValue;
}): DerivedValue {
  return input.operator === 'contains' ? `%${String(input.value)}%` : input.value;
}

function operatorSql(operator: 'equals' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte'): string {
  switch (operator) {
    case 'equals': return '=';
    case 'contains': return 'LIKE';
    case 'gt': return '>';
    case 'gte': return '>=';
    case 'lt': return '<';
    case 'lte': return '<=';
  }
}
