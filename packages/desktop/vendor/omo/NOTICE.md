# OMO source attribution

Source: https://github.com/code-yeongyu/oh-my-openagent at 8bd0c35b3ba532ab0cb0df49ea71467303aa92ba.

Hashline helpers and the 17 shared Skill references retain the Sustainable Use License in LICENSE.md, except separately licensed units (ast-grep Skill: MIT). The LSP JSON-RPC connection is adapted from lsp-core, whose MIT lineage is documented by the source THIRD-PARTY-NOTICES.md (pi-lsp-client); its license and NOTICE are retained under lsp/.

Prime modifications: LSP frame size bounds, already-aborted request rejection, disposal on stream close; separate task, AST, file-edit and LSP adapters are authored for Prime. Skill entrypoints are rewritten for actual Prime tool names and authorization. Upstream Skill references are unmodified and are background material, not executable host instructions.

No Native/Senpi runtime, telemetry, stealth browser engine, external browser binaries, generated frontend submodule assets, or external account credentials are included. Source hashes and copied-file inventory are in manifest.json. This mixed-license distribution must preserve these terms; the desktop MIT label does not relicense OMO material.
