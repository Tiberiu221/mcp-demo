# mcp-demo: server MCP minimal (TypeScript, stdio)

Un server MCP mic și testat, cu trei tool-uri de „ops” pentru OFAI: verifică dacă site-ul răspunde, citește finalul unui log și explică expresii cron în română.

## Ce e MCP, pe scurt

- **MCP (Model Context Protocol)** e un protocol deschis (JSON-RPC 2.0) prin care un agent AI (Claude Code, Claude Desktop, IDE-uri) folosește unelte externe într-un mod standard.
- Un server expune **tools** (acțiuni pe care le apelează modelul), **resources** (date read-only, ex. fișiere) și **prompts** (șabloane reutilizabile).
- Clientul descoperă tool-urile cu `tools/list` (nume, descriere, JSON Schema pentru input) și le apelează cu `tools/call`.
- **stdio**: clientul pornește serverul ca proces local și comunică prin stdin/stdout. E simplu și nu folosește rețeaua, ideal pentru unelte locale.
- **Streamable HTTP**: serverul rulează la distanță, la un URL, pentru servicii partajate de o echipă, cu autentificare (OAuth).

## Structura

```
src/index.ts        McpServer + registerTool (scheme zod) + StdioServerTransport
src/health.ts       site_health: GET cu timeout de 5 s, status, latență, primele 300 de caractere din body
src/logTail.ts      read_log_tail: allow-list de directoare + realpath, citește doar finalul fișierului
src/cron.ts         cron_explain: funcție pură, fără I/O, deci ușor de testat
src/*.test.ts       12 teste node:test (8 pentru cron + 4 pentru securitatea path-urilor)
scripts/smoke.mjs   pornește serverul și îi trimite JSON-RPC brut: initialize → tools/list → tools/call
.mcp.json           înregistrează serverul în Claude Code (scope de proiect)
```

Fiecare tool are un nume, o descriere (pe care o citește modelul) și o schemă zod pentru input. SDK-ul transformă schema în JSON Schema și validează argumentele înainte să intre în handler. Dacă handlerul aruncă o eroare, ea ajunge la model ca rezultat `isError: true`, așa că modelul citește mesajul și își poate corecta apelul.

## Rulare

```bash
npm install
npm run build      # tsc → dist/
npm test           # build + 12 teste unitare
npm run smoke      # build + test end-to-end pe stdio
```

## Înregistrare în Claude Code (`.mcp.json`)

```json
{ "mcpServers": { "ofai-ops": { "type": "stdio", "command": "node", "args": ["dist/index.js"] } } }
```

Un `.mcp.json` pus în rădăcina proiectului are scope **project**: se comite în git și îl primește toată echipa. Claude Code îl citește când pornește în acest folder și lansează serverul ca proces copil. La prima rulare cere aprobare, ca un repo clonat să nu poată porni cod doar pentru că are un `.mcp.json`.
Variantă doar pentru tine (scope local): `claude mcp add ofai-ops -- node "$PWD/dist/index.js"`.

## Test din Claude Code

```bash
cd ./mcp-demo && npm run build
claude mcp list    # înainte de aprobare: "ofai-ops: node dist/index.js - ⏸ Pending approval"
claude             # la pornire aprobi serverul „ofai-ops”
```

În sesiune, `/mcp` arată serverul și cele 3 tool-uri. Apoi poți cere:

- „Explică-mi cron-ul `*/15 9-17 * * 1-5`.” → `mcp__ofai-ops__cron_explain`
- „Verifică dacă ofai.ro e sus.” → `mcp__ofai-ops__site_health`
- „Arată-mi ultimele 20 de linii din /var/log/install.log.” → `mcp__ofai-ops__read_log_tail`
- „Citește ~/.ssh/id_rsa cu read_log_tail.” → refuzat cu `Access denied`

După aprobare, `claude mcp list` face health check și arată serverul ca fiind conectat.
Dacă `claude` nu e în PATH: `npm install -g @anthropic-ai/claude-code`, apoi `claude` și `/login`.

## Securitate

- **Allow-list de path-uri**: `read_log_tail` citește doar sub `~/Desktop` și `/var/log`. Path-ul trece prin `realpath`, care rezolvă symlink-urile și `..`, deci un symlink din Desktop spre `~/.ssh` e refuzat.
- Verificarea folosește `path.relative`, nu `startsWith`, ca `Desktop-evil` să nu treacă drept `Desktop`. Pe macOS `/var` e symlink spre `/private/var`, așa că root-urile se compară în ambele forme.
- Pentru un fișier inexistent din afara allow-list-ului răspunsul e tot „Access denied”, ca serverul să nu dezvăluie ce există pe disc.
- Se citesc doar ultimii 256 KB și maxim 200 de linii. Se verifică întâi că e fișier obișnuit, pentru că un FIFO ar bloca serverul.
- **Timeout**: `site_health` folosește `AbortSignal.timeout(5000)`, care acoperă și citirea body-ului. Acceptă doar URL-uri `http(s)` (validate cu zod), deci nu `file://`.
- **Fără secrete**: nu are chei, token-uri sau `.env` și nimic de configurat. Toate tool-urile sunt marcate `readOnlyHint`.
- **stdout e rezervat protocolului**: logurile merg pe stderr, pentru că un `console.log` ar strica JSON-RPC-ul.
- Pe un server deployat prin HTTP aș adăuga autentificare și o allow-list de host-uri pentru `site_health`, ca să evit SSRF.

## Notă despre versiunea SDK

`@modelcontextprotocol/sdk` 1.32.1, ultima versiune de pe npm, e linia **v1 de mentenanță** și implementează spec-ul MCP 2025-11-25.
SDK-ul v2 (spec 2026-07-28) e publicat separat, ca `@modelcontextprotocol/server` și `@modelcontextprotocol/client`.
Am verificat traficul real: Claude Code 2.1.289 trimite întâi `server/discover` (spec 2026-07-28), iar serverul v1 răspunde `Method not found`.
Claude Code revine apoi la `initialize` cu versiunea 2025-11-25, iar conexiunea și tool-urile funcționează.
