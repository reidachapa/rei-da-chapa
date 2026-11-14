# Numeração de pedidos em vários aparelhos — Plano

> **Implementação concluída em 2026-11-14.** A publicação foi autorizada pelo usuário após implementação.

**Objetivo:** atribuir números únicos a pedidos feitos simultaneamente em aparelhos diferentes.

**Arquitetura:** o Supabase reserva os números geral e diário com lock por loja e request ID idempotente. O cliente persiste o pedido, depois o envia à fila de impressão compartilhada já existente.

**Tecnologias:** HTML/JavaScript existente, Supabase Postgres/RPC, migrações SQL.

**Especificação:** `docs/superpowers/specs/2026-11-14-numero-pedido-multicelular-design.md`.

## Restrições

- Dia comercial muda às 06:30 em `America/Sao_Paulo`.
- Pedido e sequência são compartilhados por loja.
- IDs de pedido atuais são texto; a RPC recebe texto, não UUID.
- Pedidos existentes e `public.estado` devem permanecer intactos, incluindo os dois pedidos que apareceram com nº 1 na inspeção inicial.
- RPC usa `SECURITY INVOKER`; sem senha nova, sem alteração às policies existentes de `estado`.
- A fila compartilhada já existente continua sendo o único caminho de impressão automática.
- Não executar testes automatizados nesta tarefa.
- Contadores locais precisam aceitar merge concorrente por máximo, sem conflito artificial entre dispositivos.
- A fila deve exibir ação para retirar uma ficha ainda pendente.

## Foco de revisão

1. Duas reservas concorrentes na mesma loja devolvem números diferentes.
2. Retry com o mesmo request ID devolve a reserva original.
3. Retry após 06:30 usa o novo dia comercial somente para um request ID novo.
4. Contadores seed incluem pedidos abertos e histórico sem renumerá-los.
5. RPC indisponível ou save não confirmado não limpa silenciosamente o carrinho nem enfileira ficha.

---

### Tarefa 1: Migração do contador atômico

**Arquivos:** criar migração em `supabase/migrations/`; modificar `index.html` somente depois.

- [x] Criar duas migrações com versões coincidentes com o histórico do Supabase. O CLI não está instalado; a migração foi aplicada pelo MCP do Supabase.
- [x] Criar tabelas de contador por loja e reserva por request ID no schema não exposto `app_internal`, ambas com RLS e policies explícitas.
- [x] Semear os números gerais e diários a partir de `estado.dados.porLoja`, `pedidos`, `historico` e `contadores`.
- [x] Criar RPC invoker que valida a loja, bloqueia a linha do contador, retorna reserva existente ou incrementa os dois contadores atomicamente.
- [x] Revisar SQL: não há instrução que altere `public.estado` nem pedidos existentes.
- [x] Permitir exclusão da fila apenas para ficha pendente.

### Tarefa 2: Fechamento do pedido

**Arquivos:** modificar `index.html`.

- [x] Adicionar chamada RPC usando `lojaAtivaId` e ID texto estável do pedido.
- [x] Usar os números retornados na estrutura do pedido; remover incrementos locais como fonte oficial.
- [x] Bloquear toque duplo durante a reserva e gravação.
- [x] Aguardar `salvar()` antes de fechar o modal, anunciar sucesso ou mandar imprimir.
- [x] Reusar a mesma tentativa após falha sem duplicar o pedido ou a ficha.
- [x] Persistir o payload completo e deltas de estoque no aparelho enquanto o salvamento estiver pendente; recuperar após recarga e usar o mesmo ID.
- [x] Mesclar baixas de estoque de vendas simultâneas em aparelhos diferentes.
- [x] Mesclar contador geral pelo maior número e contador diário pela data comercial e maior número, evitando conflito no salvamento simultâneo.

### Tarefa 3: Revisão final

- [x] Revisar mudanças e `git diff --check`.
- [x] Conferir no Supabase que `public.estado` continuou no mesmo `atualizado_em`, contadores e totais de pedidos antes e depois da migração.
- [x] Conferir advisors de segurança e performance após as migrações; ambos ficaram sem findings.
- [x] Conferir sintaxe dos blocos JavaScript alterados; testes automatizados não foram executados.
- [ ] Fazer revisão independente do diff e publicar a versão autorizada.
