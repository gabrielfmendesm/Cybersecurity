# Cybersecurity – Extensão Firefox: Privacy Guard

Projeto de extensão para Firefox que:

- Usa EasyList para detectar e bloquear domínios de rastreamento.
- Mostra conexões de terceiros, cookies (1ª e 3ª parte), e headers Set‑Cookie.
- Detecta uso de Storage (localStorage, sessionStorage, IndexedDB).
- Sinaliza tentativas de canvas fingerprinting.
- Heurística de sincronismo de cookies (cookie syncing).
- Placar de privacidade (0–100) e alternância de tema (claro/escuro).

Como testar localmente no Firefox:

1. Abra `about:debugging#/runtime/this-firefox`.
2. Clique em "Load Temporary Add-on…".
3. Selecione o arquivo `extension/manifest.json`.
4. Navegue por alguns sites e abra o popup do add-on para ver os dados.

Tema:

- Escuro (padrão) com destaque verde brilhante.
- Claro com destaque laranja brilhante. O estado fica salvo em `storage.sync`.

Observações:

- O bloqueio usa um subconjunto de regras da EasyList (host-based `||dominio^`).
- Para detecção de IndexedDB, em versões do Firefox que não expõem `indexedDB.databases()`, é usado um heurístico.
