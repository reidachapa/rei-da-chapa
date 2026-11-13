# Endurecimento de segurança local sem login obrigatório — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Corrigir sinks XSS e bytes de controle na impressão e preparar redução de grants não usados sem alterar o modelo atual de acesso anon.

**Architecture:** Usar `esc` existente em todos os campos de ícone/ID que chegam a `innerHTML`, filtrar controles na fronteira comum `encode`, e preparar uma migration data-preserving que preserve as permissões necessárias aos clientes atuais. O app segue sem login; riscos de leitura/UPDATE anon e isolamento da fila ficam explicitamente abertos.

**Tech Stack:** HTML/JavaScript inline, Node.js built-in test runner, migrations PostgreSQL/Supabase.

**Spec:** `docs/superpowers/specs/2026-11-13-seguranca-local-sem-login.md`

## Global Constraints

- Não aplicar alterações ao projeto Supabase ativo.
- Não mesclar nem publicar.
- Não adicionar senha/login obrigatório.
- Preservar sincronização anon atual, notas, pedidos, estoque e fila de impressão.
- Não remover comandos ESC/POS constantes que o app usa para formatar recibos.

## Review Focus

- Strings de ícone HTML em backup/estado remoto devem aparecer como texto, não markup.
- IDs contendo aspas/HTML não devem criar atributos ou elementos.
- ESC, GS, C0/C1 devem ser neutralizados; newline e texto CP850 legítimos devem permanecer.
- `public.estado` continua com SELECT/UPDATE anon e a fila continua com SELECT/INSERT/UPDATE.
- A migration não apaga nem atualiza linhas/dados existentes.

---

### Task 1: Regressões para HTML e saída ESC/POS

**Files:**
- Create: `tests/security-hardening.test.cjs`
- Read: `index.html`, migration SQL

- [ ] Adicionar testes com `node:test` que carregam o `esc` e `encode` reais do `index.html`.
- [ ] Testar payload HTML em texto e ícone, além de IDs escapados em `data-*`.
- [ ] Testar ESC `0x1B`, GS `0x1D`, C0/C1, newline, `á` e símbolo não representável.
- [ ] Rodar `node --test tests/security-hardening.test.cjs`; confirmar falha esperada antes do patch.

### Task 2: Neutralizar dados e texto da impressora

**Files:**
- Modify: `index.html`
- Test: `tests/security-hardening.test.cjs`

- [ ] Escapar ícones dinâmicos e IDs inseridos em HTML em renderers de ingredientes, pães, produtos, pedidos e clientes.
- [ ] Manter texto de nome/descrição e fluxo de venda existentes.
- [ ] Neutralizar ESC/GS e controles não imprimíveis na função comum `encode`, mantendo LF e mapeamentos de texto existentes.
- [ ] Rodar o teste focado; confirmar passagem de entradas seguras e maliciosas.

### Task 3: Preparar migração de grants não usados

**Files:**
- Create: `supabase/migrations/20261113210000_restrict_unused_anon_privileges.sql`
- Test: `tests/security-hardening.test.cjs`

- [ ] Revogar grants amplos de `PUBLIC`, `anon` e `authenticated` nas tabelas existentes.
- [ ] Recriar em `public.estado` policies explícitas de SELECT/UPDATE para `anon` e `authenticated`, e conceder somente essas permissões.
- [ ] Manter SELECT/INSERT/UPDATE na fila e estações; retirar DELETE/TRUNCATE não usados.
- [ ] Não executar SQL no Supabase. Testar migração estática para preservar dados e permissões do app.

### Task 4: Verificação final

- [ ] Rodar `node --test tests/*.test.cjs`.
- [ ] Rodar `node --check print-queue.js` e validar os scripts extraídos do HTML.
- [ ] Revisar `git diff` e confirmar que não houve escrita remota, merge ou publicação.
