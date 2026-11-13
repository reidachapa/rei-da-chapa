# Fila compartilhada de impressão Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compartilhar os pedidos de impressão entre PC e celulares Android e imprimir pela estação ativa em ordem, uma ficha por vez.

**Architecture:** Criar uma fila persistida em tabelas Supabase separadas do JSON `public.estado`, com chaves idempotentes, snapshot de ticket reduzido e reserva temporária por loja. Integrar o PC ao fluxo serial/USB já existente e o Android ao app Bluetooth Print/Thermer, preservando confirmação manual quando o navegador não puder confirmar uma impressão física.

**Tech Stack:** HTML/CSS/JavaScript em `index.html`, Supabase JS v2, Postgres/RLS/Realtime, Web Serial no PC e compartilhamento/integração Android do Bluetooth Print.

**Spec:** `docs/superpowers/specs/2026-11-13-fila-compartilhada-impressao-design.md`

## Global Constraints

- Não modificar os dados de compras, estoque ou pedidos existentes no registro `public.estado` para armazenar a fila.
- Uma estação por loja processa somente um trabalho por vez.
- Chave única do evento impede impressão duplicada por cliques repetidos; reimpressão deliberada cria outro trabalho.
- Falha com resultado físico incerto exige conferência antes de reenviar.
- A impressão física na GS-MTP5 não poderá ser declarada validada sem teste posterior com a impressora.
- Não executar testes automatizados nesta implementação; fazer revisão estática do diff e registrar teste físico pendente.

## Review Focus

- Dois aparelhos tentam reivindicar a mesma estação: a reserva por loja permite somente um vencedor.
- Clique repetido na confirmação do pedido ou reenvio de estado: a chave idempotente mantém um único trabalho.
- Pedido ainda não sincronizado quando o trabalho chega à estação: manter pendente e buscar novamente, sem descartar.
- Perda de rede durante o envio: marcar como conferência após expiração, sem repetição automática.
- Android cancela o compartilhamento/retorna do Bluetooth Print: não marcar como impresso sem confirmação.

---

### Task 1: Esquema persistente da fila

**Files:**
- Create: `supabase/migrations/<timestamp>_shared_print_queue.sql` (gerado com `supabase migration new`)

**Interfaces:**
- Produces: `public.fila_impressao` com chave idempotente, `loja_id`, `pedido_id`, tipo, metadados mínimos do pedido, estado, datas, tentativas e erro.
- Produces: `public.fila_impressao_estacoes` com uma reserva temporária por `loja_id`.

- [x] Criar as duas tabelas, índices únicos/ordem, constraints de estado, RLS habilitado e grants/policies para o cliente atual.
- [x] Manter `public.estado` e as policies atuais inalterados; usar polling para a fila, sem adicionar tabelas à publicação Realtime.
- [x] Gerar a migração pelo Supabase CLI e aplicá-la ao projeto depois de preparar o serviço cliente. A tabela `public.estado` continua com 1 linha.

### Task 2: Serviço cliente da fila e reservas

**Files:**
- Modify: `index.html`

**Interfaces:**
- Produces: `enfileirarTicket(pedido, tipo, chaveEvento)` persiste snapshot reduzido e trata `job_key` repetida como já existente.
- Produces: `iniciarEstacaoImpressao(lojaId)` e `liberarEstacaoImpressao(lojaId)` adquirem/liberam a reserva da loja.
- Produces: `processarProximoTicket()` reivindica o próximo pendente por atualização condicional e registra resultado.

- [x] Enfileirar depois da confirmação de gravação do pedido, por loja, em ordem do servidor, com chave idempotente.
- [x] Reivindicar estação com lease renovável; a função no Supabase reivindica um trabalho por vez e a estação usa Web Locks entre abas.
- [x] Serializar reivindicações também no banco, evitando que abas da mesma estação peguem dois trabalhos em paralelo (`20261113174019_print_queue_single_claim`).
- [x] Bloquear nova impressão em outra estação até o trabalho anterior terminar ou expirar (`20261113174731_print_queue_single_inflight`).
- [x] Tratar expiração/falha como `conferir`; oferecer ações para confirmar o papel ou reenviar explicitamente.
- [x] Consultar a fila a cada 2,5 segundos enquanto a estação está ativa.
- [x] Ao reenviar, atualizar a data de criação para que o trabalho volte ao fim da fila (`20261113172918_print_queue_retry_order.sql`).

### Task 3: Conectar os fluxos existentes de impressão

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: serviço da fila da Task 2.
- Produces: eventos `novo`, `alteracao` e `reimpressao` com chaves estáveis ou aleatórias conforme a intenção.

- [x] Novos pedidos e alterações entram na fila após confirmação de salvamento; pedidos repetidos não geram fichas duplicadas.
- [x] Impressão manual e reimpressão entram na fila; a estação ativa é a única que processa.
- [x] Manter os renderizadores ESC/POS no PC; no Android abrir a janela de impressão do sistema para escolher Thermer e exigir confirmação manual.
- [x] Cancelamento/retorno Android não marca a ficha como impressa; o trabalho fica para conferência.
- [x] Preservar o envio PC pela conexão serial/USB existente.

### Task 4: Controles de estação e status visível

**Files:**
- Modify: `index.html`
- Modify: `sw.js`

**Interfaces:**
- Consumes: serviço da fila e renderizadores da Task 3.

- [x] Na janela Impressora, mostrar estação ativa, pendências e trabalhos que exigem conferência.
- [x] Adicionar ações para ativar/liberar esta estação, imprimir próximo, confirmar papel e reenviar.
- [x] Mostrar feedback quando a fila recebe pedido sem uma estação ativa.
- [x] Atualizar a versão exibida e o cache do service worker para v1.0.27.

### Task 5: Fechamento e preparação do teste físico

**Files:**
- Review: `index.html`, `sw.js`, migration

- [x] Conferir `git diff --check`, confirmar que `estado` não recebe campos da fila e que não foi incluída credencial secreta.
- [x] Não rodar testes automatizados nesta tarefa; `node --check` e `git diff --check` passaram.
- [x] Registrar validação física pendente: PC via COM/USB; Android com Bluetooth Print/Thermer e GS-MTP5; dois aparelhos inserindo eventos; falha de conexão e retomada.
- [ ] Atualizar PR para revisão sem mesclar/publicar até os testes físicos e a revisão dos dados da fila.
