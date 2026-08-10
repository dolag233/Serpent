# Serpent Domain Language

Serpent manages file-backed digital assets across libraries while keeping organization, metadata, derived content, and automation behavior consistent across its user interfaces.

## Access surfaces

**Desktop client**:
The graphical first-party interface to Serpent. It has the same domain authority as the command-line client.
_Avoid_: Primary client, canonical client

**Command-line client (CLI)**:
The textual first-party interface to Serpent, designed to be usable by both people and software agents. It exposes domain capabilities rather than raw database or unrestricted filesystem access.
_Avoid_: Agent API, secondary client, debug console

## Identity and selection

**Stable identifier**:
The location-independent identity of a Serpent entity. Moving or renaming the entity does not change this identity.
_Avoid_: Path, display name

**Library-relative resource path**:
The unique path of an addressable entity within one explicitly selected library. It is a stable user-facing address only while that entity remains at that location; moving or renaming the entity changes the path but not its stable identifier.
_Avoid_: Filesystem path, display name, collection path

**Resource reference**:
An exact reference that resolves to one entity in one explicitly selected library. Serpent accepts only a stable identifier or a unique library-relative resource path as a resource reference.
_Avoid_: Search query, filter, tag, collection

**Asset filter**:
A condition that selects a set of assets by properties or organization, such as tags, collections, folders, ratings, or formats. A filter is not an exact resource reference.
_Avoid_: Resource reference, search query

## Discovery and search

**Browsable asset set**:
The assets reachable in the active workspace context after its current navigation scope, recursive-browse choice, and structured filters are applied. A keyword search narrows this set rather than implicitly changing it to an entire library or a different collection.
_Avoid_: Global library result set, visible cards

**Plain-text search**:
A case-insensitive contains search over every indexed asset field, including filename, tags, description, source link, author, folder path, and metadata. It accepts a one-character term, starts automatically after a 200ms input debounce, and is distinct from structured filtering. It is the only search mode; AI analysis does not create a separate search path.
_Avoid_: Exact-token search, tag filter, AI search

**Search expression**:
The text entered into the workspace search box. Whitespace-separated terms are conjunctive, `|` separates alternatives, a leading `-` excludes a term, and double quotes preserve a literal phrase. A field clause limits a term to a canonical asset field: `name:`, `tag:`, `desc:`, `link:`, `author:`, `path:`, or `meta:`. The expression is evaluated only within the browsable asset set.
_Avoid_: Filter preset, smart collection

**Highlighted match**:
The exact text span matched by a plain-text search term within a result's displayed searchable value. Result cards render matching filename spans and contextual snippets with a distinct but accessible emphasis without changing the underlying value.
_Avoid_: Selected text, tag color

## Plugin runtime and interaction

**Plugin instance**:
A running unit of one resolved plugin version. Its runtime scope is either global to the application session or isolated to one open library, independently of where its package was installed.
_Avoid_: Plugin installation, always library-bound activation

**Contribution context**:
The bounded, synchronously readable UI state published by the Host for conditions such as visibility, enablement, and checked state. It is not an asset query or mutation API.
_Avoid_: Domain API, invocation target

**Invocation context**:
The frozen window, library, surface, and target-selection snapshot captured when a command is invoked. The command uses it to identify the operation target, then uses the Domain API for details and actions.
_Avoid_: Live selection, contribution context

**Context key**:
A canonical value available to contribution condition expressions. Expensive plugin-derived values are resolved asynchronously and published under the plugin namespace before a UI surface opens.
_Avoid_: Synchronous plugin callback, arbitrary expression code

## Automation

**Automation execution**:
The bounded authorization, resource-budget, audit, and cancellation lifecycle for one script run or one MCP connection. It may have no active library and does not end merely because its active library changes.
_Avoid_: Library binding, MCP process, transport session

**Active library context**:
The one library targeted by subsequent library-scoped commands in an Automation Execution. It changes only through an explicit context transition and is independent of Desktop focus.
_Avoid_: Current folder, focused library, permanent binding

**Library authorization**:
Local human consent for an Automation Execution to use a specific library with a stated capability set. Authorization permits a context transition but is not itself the active library context.
_Avoid_: Active library, write-access flag, library binding

**Automation capability**:
A stable permission unit for one class of semantic domain actions. Possessing it permits a request but never bypasses domain validation, library authorization, an execution plan, or a critical confirmation.
_Avoid_: Write-access flag, tool name, risk level

**Permission policy**:
A user-managed, persistent decision for whether one identified automation client must ask for or may always use one non-critical Automation Capability. It does not grant library access and never applies to critical operations.
_Avoid_: Global trust, credential, all-powerful mode

**Session permission grant**:
An in-memory decision allowing one identified Automation Execution to reuse one non-critical Automation Capability until that execution ends or the decision is revoked.
_Avoid_: Persistent permission, client credential, library authorization

**One-shot operation approval**:
A decision allowing one specific, currently validated operation to proceed once. When an Execution Plan exists, the approval is bound to that plan and becomes invalid when its target or preconditions change.
_Avoid_: Session permission, permanent permission

**Critical confirmation**:
A mandatory per-operation local confirmation for an irreversible, low-frequency, or broad-impact action. It cannot be satisfied by a Permission Policy, Session Permission Grant, or an “allow all” setting.
_Avoid_: Permission prompt, warning toast, suppressible confirmation
