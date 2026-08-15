# Automation

Serpent offers two kinds of automation: scripts for batch organization, and MCP for connecting an external AI tool to Serpent. Normal browsing, importing, and viewing do not require either one.

## Automation scripts

Scripts are useful for repeated organizing work, such as adding tags in bulk, changing ratings, or moving assets into a folder.

1. Open a library.
2. Choose **More tools → Automation scripts**.
3. Create or open a script, read it first, and click Run.
4. Return to the asset canvas and check the result. When unsure, try a small selection first.

Scripts modify a library only through the operations Serpent provides; they do not run arbitrary programs on your computer. Use scripts from sources you trust and back up important libraries before a large batch.

## Connect an external AI tool (MCP)

MCP lets an external AI tool read and organize Serpent assets. It works on this computer and does not publish your library to the internet automatically.

1. Open **Settings → MCP**.
2. Enable the MCP service, and enable **Auto-start** if you want it to start with Serpent.
3. Click **Add client** and choose the format for your client.
4. Paste the configuration copied by Serpent into the AI tool.

The default address is `http://127.0.0.1:47342/mcp`. The Token is shown only when it is created, so keep it like a password. Revoke a Token from MCP settings when you no longer use that client.

![MCP settings and client configuration](../assets/ui/MCP-settings.png)

Only enable the connection for a local AI tool you trust. Serpent still asks for confirmation before impactful operations such as deleting or moving assets.

## More information

For complete commands, development guidance, and integration examples, see the [extension author manual](../manual/README.md).
