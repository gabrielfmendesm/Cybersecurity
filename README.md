# Privacy Guard (Firefox) — Relatório Técnico

Extensão para navegador Firefox focada em privacidade do usuário, com detecção e bloqueio de rastreadores, visualização de conexões de terceiros, análise de cookies e supercookies (Storage HTML5), detecção de fingerprinting e pontuação de privacidade.

— Diretório da extensão: `extension/`

## Visão Geral

- Lista EasyList embutida para bloquear domínios de rastreamento.
- Monitoramento por aba de: conexões de terceiros, cookies, supercookies (Storage HTML5), cookie sync, fingerprinting (canvas) e risco de hijacking/hook.
- Score de privacidade (0–100) exibido como barra horizontal com cores alinhadas aos temas.
- Tema claro/escuro com botão de alternância por ícone (lua/sol).
- Personalização: blocklist e allowlist do usuário (listas persistentes).
- Diferenciação de bloqueios: rastreadores de 1ª parte vs 3ª parte (KPI no popup).

## O que é analisado

- Conexões de terceiros
  - Contabiliza toda requisição cujo domínio base difere do domínio base da aba.
  - Lista os domínios mais frequentes por aba.

- Rastreadores (bloqueio)
  - Compara o host de cada requisição com a EasyList (subconjunto host-based `||dominio^`).
  - Se houver match (inclui subdomínios), a requisição é cancelada (bloqueio).
  - Precedência de personalização: `allowlist` do usuário > `blocklist` do usuário > EasyList.
  - Classificação de bloqueios: 1ª parte (mesmo domínio base) e 3ª parte (domínios diferentes).

- Cookies
  - Headers Set‑Cookie: total; segmentação em 1ª parte e 3ª parte.
  - Envio de cookies: conta requisições com header `Cookie`.
  - Sessão x Persistente: classifica por presença de `Expires`/`Max-Age` no Set‑Cookie.
  - Observação sobre “supercookies”: este projeto aborda “supercookies” no sentido amplo de persistência no cliente mapeando armazenamentos HTML5 (localStorage, sessionStorage e IndexedDB). Técnicas baseadas em cache/ETag/HSTS ou camadas de rede não são detectadas; ver “Limitações”.

- Supercookies (Storage HTML5)
  - localStorage: número de chaves e tamanho estimado (bytes) somando chave+valor.
  - sessionStorage: idem ao localStorage.
  - IndexedDB: contagem de bancos (via `indexedDB.databases()` quando disponível; fallback heurístico quando não).
  - KPI no popup: “Supercookies (total)” = `localStorage.keys + sessionStorage.keys` (IndexedDB exibido separadamente).

- Cookie Sync (sincronismo)
  - Heurística que verifica parâmetros de query de requisições de 3ª parte buscando nomes de cookies conhecidos, valores idênticos e parâmetros com nomes típicos (sid, uid, _ga, fbp etc.).

- Fingerprinting (Canvas)
  - Sinaliza uso de `HTMLCanvasElement.toDataURL()` e `CanvasRenderingContext2D.getImageData()` como eventos de fingerprinting de canvas.

- Hijacking/Hook (sinalização)
  - Indica o carregamento de scripts de 3ª parte como “potenciais hooks” (indicador, não‑bloqueio).

## Score de Privacidade (0–100)

O score começa em 100 e sofre descontos conforme sinais de risco/rasteamento:

- Rastreadores bloqueados: −2 pontos por evento, até −40.
- Conexões de terceiros: −1 a cada 5 requisições, até −20.
- Set‑Cookie (qualquer parte): −1 a cada 5 eventos, até −10.
- Supercookies (local + session): −1 a cada 10 chaves, até −10.
- Fingerprinting (canvas): −15 se houver pelo menos um evento.
- Cookie Sync: −15 se houver pelo menos um evento.
- Potenciais hooks (scripts 3ª parte): −5 a cada 5 eventos, até −15.

Cores da barra:
- Score alto (≥80): usa a cor de destaque do tema (verde no escuro, laranja no claro).
- Score médio (50–79): amarelo idêntico em ambos os temas.
- Score baixo (<50): vermelho idêntico em ambos os temas.

## Como usar e instalar

Carregar temporariamente no Firefox (desenvolvimento):
1. Abra `about:debugging#/runtime/this-firefox`.
2. Clique em “Load Temporary Add-on…”.
3. Selecione `extension/manifest.json`.
4. Abra o popup da extensão ao navegar em qualquer site para visualizar os dados coletados.

Alternância de tema:
- Use o botão de tema no cabeçalho do popup. O estado (claro/escuro) é salvo em `storage.sync` e persiste entre sessões.

Personalização (listas):
- No popup, use a seção “Listas Personalizadas” para adicionar domínios à `Blocklist` (sempre bloquear) e à `Allowlist` (nunca bloquear). Domínios aceitam subdomínios.
- As listas são salvas em `storage.sync` e aplicadas imediatamente; a `Allowlist` tem precedência sobre todas as demais regras.

## Arquitetura (resumo)

- Background: `extension/js/background.js:1`
  - Carrega/parsa a EasyList, intercepta `webRequest` (bloqueio e métricas), inspeciona headers, agrega estatísticas por aba, responde ao popup.
  - Carrega e observa `userBlocklist` e `userAllowlist` (`storage.sync`), aplicando precedência nas decisões de bloqueio.
  - Conta bloqueios de 1ª e 3ª parte separadamente.

- Content Script: `extension/js/content.js:1`
  - Coleta métricas de storage e sinaliza eventos de canvas.

- Popup (UI): `extension/popup.html:1`, `extension/css/popup.css:1`, `extension/js/popup.js:1`
  - Exibe score, conexões de terceiros, cookies, supercookies (Storage HTML5), fingerprinting e cookie sync; contém o botão de alternância de tema.
  - Seção “Rastreadores Bloqueados” mostra KPIs para 1ª parte, 3ª parte e total.
  - Seção “Listas Personalizadas” para gerenciar `Blocklist` e `Allowlist`.

## Permissões e justificativa

- `webRequest`, `webRequestBlocking`: interceptar/cancelar requisições para domínios de rastreamento.
- `<all_urls>`: observar tráfego da aba ativa para contabilização e bloqueio.
- `cookies`: leitura de cookies de 1ª parte para heurística de cookie sync.
- `storage`: persistir preferência de tema.
  - Também persistir listas personalizadas de domínio (blocklist/allowlist).
- `tabs`, `activeTab`, `webNavigation`: obter contexto da aba e reiniciar métricas por navegação.

## Atribuições e Licenças

- EasyList (arquivo `extension/assets/easylist.txt`)
  - Site: https://easylist.to/
  - Licença: CC BY-SA 3.0 — https://easylist.to/pages/licence.html
  - Texto da licença: https://creativecommons.org/licenses/by-sa/3.0/

## Limitações conhecidas

- O motor de regras usa o subconjunto host‑based da EasyList (`||dominio^`). Regras complexas (cosméticas, exceções específicas) não são aplicadas.
- Indexação de IndexedDB pode não estar disponível em todas as versões; usa fallback heurístico.
- Heurísticas (cookie sync, hooks, fingerprint) são indicadores — não substituem auditoria completa.
- Personalização atual é host-based; não há suporte a regras avançadas (ex.: paths, tipos de recurso, exceções condicionais).

## Troubleshooting

- O popup não mostra dados? Recarregue a aba e abra o popup novamente; navegações reiniciam as métricas.
- Sites corporativos com bloqueios rígidos podem exigir recarregar a extensão após alterações.

---

Este documento resume o escopo técnico e as decisões de projeto para atender ao objetivo de detectar e apresentar: conexões de 3ª parte, cookies (1ª/3ª, sessão/persistente), supercookies (Storage HTML5), sincronismo de cookies, potenciais hooks e fingerprinting, além de bloquear rastreadores conhecidos (EasyList) e compor um score claro e justificável.
