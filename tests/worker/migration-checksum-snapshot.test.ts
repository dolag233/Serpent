/**
 * Golden migration checksum snapshot (Serpent-033e/ADR-0028 强化)。
 *
 * 2026-08-15 事故：两条开发线并行各自把迁移注册为 v37（sync vs
 * auto-analysis suppression）。一条线先打开了真实库，使该库的
 * schema_migrations 行固化了其中一个 checksum；另一条线把不同 SQL 挂到
 * 同一版本号后，verifyMigrationHistory 校验 checksum 不一致 → 旧库报
 * LIBRARY_CORRUPT（"所选文件夹不是有效的 Serpent 资源库"）。
 *
 * 守护：任何已发布迁移的 SQL（从而 checksum）一旦改动，本测试即红。
 * 新增迁移只允许在末尾追加版本号，且必须同步更新本快照。
 */
import { describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../../src/worker/library-service';

const GOLDEN_CHECKSUMS: Record<number, string> = {
  1: '10cc4c4b8f7d7fbdeb58217b7e834bf1a681270b02698450630d4412b5b828b2',
  2: '7a7e996ead2997e693411a57a40ade357e0e6f34f49c86157ab59c96774ac5b8',
  3: 'a85371e263ae06611150e3fe78f84e545fb6d3c4dca7056575c66d42add9086b',
  4: '7fe1a8db5e835598ee61a5c433de4efdec1471054357e609aa8d0a3cb2eddef7',
  5: '478f1fae6e0625e6feacc89bec317571fae851e87416bbb31f57500ca86c86bc',
  6: 'b1592a2e79d0a7bbad3d1ef5084ba5257ecf6e7ec4e453883d83c0812ef42bb1',
  7: '09e778c75807fe0f8f13cc0812df5b681298ed244cf1f3c047c6d3aa881aad0e',
  8: '0de5736d87dbb7ee6ad0a49372f8a4874eb9fa3d967aa41fc11dd638d2f658cf',
  9: '5a4f13a4e3b38a2e6226f036b423ab5e17a4baa5ff8f8d22feac22a69bfde88b',
  10: 'a453e276e326e9a50918c363452114d7ccbe3930e631bdf164c001bb2cf13f83',
  11: 'e3e2b0d89771f3d5e069a39ca1c1240bd424011dc2da6124211817481a8a09ae',
  12: '1a4eac67bb2efdee5c99bf9952c53e6b771c64590aefe3bde2cd9ddab3db6a11',
  13: 'a555fca31162c88acec58fd18894801347aa8d0910f631d28a97ed6a00b4d5d0',
  14: '7b051d20afb2e090250d73d0f2d3e5e87a815e697108a88f801e1c7f96fb8504',
  15: 'bf70df46ed78bc668a527c68245366c5da3a2aa1d5b1a53e78fa9a38aabe0f71',
  16: '4a7abeca12fb90d69a734fbfb65338c9dc9151758980d6d6217714caf9a4a60c',
  17: 'db78631bf2c492c44e02acc9c01a647c4f8515eb2fe2547e31d61686ac694158',
  18: 'f48d484c2a1e15eb6dd44b2f75b58086357640241a34365d3daab650349aa24c',
  19: 'c93a2eb2739db79e38d61d0a7e406e77ce097a42b20f88e027a789b97b72cd88',
  20: '56717c3efc3fe002ba1cb7777643aada4d16dea8c262ffb2bbd70e59a80ed197',
  21: '7ae97b0125dd463f62d6486d67ee1f4fea2bbe8037d19a919b2cbfc3727b6c5b',
  22: '433d3f37e1379e2422fd3fda6bb7eabcb76033a6c3d2bca8a40deda17be07c38',
  23: '79888f7f88ec282d68cfbe96e22e0dc9b61630ab386e00fb4513f5aa47d7263a',
  24: '5c1efc1633904c2a6ff3bd46702851e1622c7233c8a81fc1c3d59df051871934',
  25: '641f1cc95714378a66948980652c1fd3773458c4a4d2996bcafb95596a982d34',
  26: '768aa843bd7456c8d870243332d4f7278287d11dcb9ad4666689d4037bea0aee',
  27: '7dc6f9927d613b15fca8393a9b17c2f88e05eb38ddaa9367c0994f03ea5d1a83',
  28: 'b7af3b7d40699ce2961689b18eebbbb8fa89246d3893ab19b558f4644830e7b0',
  29: '934c70e0de6b38a5119bccbb1c678d601dac9b16224c2b5728887047d70add47',
  30: '639e696480e3f3910d91674c6ac7dd3f7027aed06eecd919545e8c54a528a397',
  31: '6e218ba9992d63df6a2b9e10e115a4329fb7bd33480b999d099379be5f3b7d46',
  32: '87c85e5e68e2740a1361be5dadc13a42297bdb89f13301a6ac5eb4694c1bb140',
  33: 'eb0c75c6965e9f6350b147903f9351177e8935375afd75dd9dd30d97c2a6d4e2',
  34: 'c363dde03a81f5a4afd4d2a69b0d6f115e06e853baec8897021e4bcfa04969d4',
  35: 'b2b464e897b5deac51384093fcf27c219c2e16db6ea9b8895b1a69dea3f7fa49',
  36: '3a628a20356dad22217b3f1bd1140f2c67876eed9af91654b1aebb589a7def63',
  37: 'c164ffd38fd4fdfd1e092d90f8af1e9a7eeb182cfb1bad5f68ef6e853224f121',
  38: '32bd45e320759725f96c903bf2e9cc1a909f126f5d8d02b46e33d1a7f677620b',
  39: '5647cb4e7fe45e3bd54fd1659024ea437abaf3709c804b01324303a12eab3add',
  40: 'c6bb1f260093633e9c04baa6547e6106419b1d42aabae1ab8d7f36a66fad9865',
  41: 'c9a809b51424500a491080d1b81fb37063c79c7a749f0ce404a76631e1594a28',
  42: '3a86df8f177fec25fb2b3151fec8506ff1085293e775532534aa303f0a1d2b57',
  43: '93ac33493cf6d136e4db1d683fef2ff98252598026cb3259a8622900ce3203dc',
};

describe('golden migration checksum snapshot (Serpent-033e)', () => {
  it('every released migration keeps its exact checksum', () => {
    const snapshotVersions = Object.keys(GOLDEN_CHECKSUMS).map(Number).sort((a, b) => a - b);
    const migrationVersions = MIGRATIONS.map((migration) => migration.version);
    // 快照必须覆盖当前全部已发布版本（新迁移必须先落进快照）。
    expect(migrationVersions).toEqual(snapshotVersions);
    for (const migration of MIGRATIONS) {
      expect(
        migration.checksum,
        `migration v${migration.version} checksum changed — released migrations are immutable`,
      ).toBe(GOLDEN_CHECKSUMS[migration.version]);
    }
  });
});
