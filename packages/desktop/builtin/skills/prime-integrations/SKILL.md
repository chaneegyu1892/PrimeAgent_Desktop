---
name: prime-integrations
description: Use connected services such as GitHub, Notion, Linear, Figma or custom MCP servers.
---

# MCP·업무 도구

1. Call desktop_mcp with action servers to see the app's enabled connections, then tools for the selected server. Inspect exact schemas; never guess tool names or parameters.
2. Use desktop_mcp(action="call", server=ID, tool=NAME, arguments={...}) for discovered tools. Resources/prompts are available through resources, read_resource, prompts and get_prompt when the server supports them.
3. A configured server is not necessarily authenticated. If connection fails, direct the user to 확장 라이브러리 > MCP for connection testing, URL, environment references or token setup. Do not copy credentials from another app.
4. Scope reads to the user's request. Prepare reviewable drafts before external writes that lack authorization. Never mark a request successful when a tool returns isError or the final state is unverified.
5. After writes, read back the exact target if supported. Keep credentials out of tool arguments, logs and artifacts.
