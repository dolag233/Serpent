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
