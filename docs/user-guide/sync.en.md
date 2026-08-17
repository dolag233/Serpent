# Sync and External Libraries

Serpent can two-way sync a library through a WebDAV server, and can open external libraries such as Eagle and Billfish directly.

## Sync overview

- Configure one or more WebDAV servers in **General settings**; each library binds to one server and a remote folder.
- Sync is bidirectional: local imports, edits, and deletions upload automatically; remote changes are pulled to the local library.
- Auto-sync is per library: after saving a binding it runs once immediately, then checks the server for changes on the configured poll interval; local asset changes upload about 10 seconds after they happen.
- A toast appears in the bottom-right while syncing or when sync completes; the library switcher (top-left, next to the library name) shows a connection icon — green link = auto-sync on, grey link-off = off (hover for details).

## Configure a WebDAV server (General settings)

Open **General settings** → **Sync** to add a sync server:

- **Server address**: must start with `http://` or `https://`; use the WebDAV path of your NAS or shared folder (for example `https://nas.local/dav/share/`).
- **Username / password**: server credentials. The password is encrypted with the system secure storage (macOS Keychain / Windows DPAPI) and never stored in plain text.
- **Allow self-signed certificate or HTTP**: enable for self-hosted servers without a proper certificate.
- After saving you can test the connection; failures show an actionable reason (invalid address, DNS, TLS, authentication, …).

![Global sync settings](../assets/ui/sync-settings.png)

## Bind a library (Library settings)

Open **Library settings** → **Sync**:

- **Sync status**: shows not synced / syncing / last synced time.
- **Server**: the server this library binds to; switching servers tests the connection automatically.
- **Sync folder name**: the remote folder name, defaults to the library name.
- **Auto sync**: when on, local changes upload and remote changes pull automatically.
- **Poll interval (seconds)**: how often remote changes are checked, 5 seconds by default. **For large libraries, consider a longer interval** to avoid frequent checks weighing on the network and disk.
- **Save**: persists the binding; turning auto-sync on triggers a sync immediately.

![Library sync settings](../assets/ui/library-sync.png)

## Open a synced library

**Open library** → **Open synced library…**:

1. Choose a configured server;
2. the panel lists synced libraries on that server (recognized by their remote manifest, so you can continue on another device);
3. pick a local destination and open — remote content is downloaded locally.

![Open synced library](../assets/ui/open-sync-library.png)

## Open external libraries (Eagle / Billfish)

**Open library** → **Open external library…** → choose **Eagle** or **Billfish**:

1. Pick the source library (an Eagle/Billfish library folder or its archive);
2. choose where Serpent should create the local library;
3. Serpent converts the source and creates a local library at the destination, showing progress while converting (a large Eagle library can take several minutes on first conversion; you can wait or cancel).

After conversion, browsing, search, tags, AI analysis, and everything else work exactly like a local library, and the original files are left untouched.

![Open external library](../assets/ui/open-external-library.png)
