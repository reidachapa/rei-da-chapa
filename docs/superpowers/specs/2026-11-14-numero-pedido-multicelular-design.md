# Numeração compartilhada de pedidos

## Intenção

Fazer os pedidos criados em celulares, tablets e PC receberem números únicos e sequenciais para a mesma loja. Dois aparelhos finalizando ao mesmo tempo não podem gerar o mesmo número.

## Por que

Hoje cada aparelho incrementa os contadores locais e depois salva o estado compartilhado. O merge por ID preserva os dois pedidos, mas os dois aparelhos podem atribuir o mesmo número antes do salvamento.

## Requisitos

- Reservar no Supabase os números geral e diário antes de criar o registro local do pedido.
- Serializar as reservas por loja no banco e usar uma chave de pedido estável para retries.
- Reiniciar a sequência diária às 06:30 no fuso `America/Sao_Paulo`.
- Inicializar os contadores a partir dos dados atuais, incluindo pedidos abertos e histórico.
- Não modificar nem renumerar pedidos já existentes, inclusive os dois pedidos que apareceram com nº 1 na inspeção inicial.
- Salvar o pedido antes de encaminhá-lo à fila compartilhada de impressão.
- Guardar no aparelho os dados completos de um pedido cuja gravação esteja pendente e recuperá-lo após fechar/atualizar, usando o mesmo ID idempotente.
- Mesclar baixas de estoque de vendas concluídas em paralelo em aparelhos diferentes.
- Mesclar os campos dos contadores por máximo de sequência para dois salvamentos simultâneos não entrarem em conflito no `estado`.
- Permitir retirar da fila uma ficha ainda pendente; fichas em impressão ficam protegidas.
- Manter a fila e o comportamento da estação de impressão existentes.
- Preservar as políticas atuais da tabela `estado`; adicionar apenas as permissões necessárias às novas tabelas e RPC, sem introduzir autenticação nova.

## Abordagens

- **Contador local sincronizado pelo estado:** rejeitado porque dois aparelhos ainda podem ler e incrementar o mesmo valor antes de salvar.
- **Gerar número no cliente e corrigir depois:** rejeitado porque fichas e telas podem mostrar números diferentes durante a corrida.
- **Reserva atômica no Supabase:** escolhida. Uma linha de contador por loja é bloqueada durante a reserva; uma tabela de reservas por ID torna retries idempotentes. O banco calcula o dia comercial no fuso de São Paulo.

## Como será feito

Migrações aditivas criam contadores e reservas no schema não exposto `app_internal`, com RLS e permissões explícitas para a RPC `SECURITY INVOKER`. A migração semeia os contadores com o maior número já lançado, sem atualizar `public.estado` nem alterar pedidos existentes. Uma policy permite excluir somente filas com status `pendente`.

O fechamento do PDV aguarda a RPC, usa o par retornado no pedido e só considera a operação concluída depois que `salvar()` confirmar o estado compartilhado. O ID e o payload completo da tentativa ficam no aparelho até a confirmação para permitir retomada após recarga sem consumir outro número. A fila existente recebe o pedido somente após essa confirmação. Se a reserva falhar, o carrinho continua aberto; se a gravação falhar, a mesma tentativa fica disponível para retry sem criar outro ID. As baixas de estoque são guardadas como deltas recuperáveis e mescladas quando aparelhos fecham vendas simultaneamente.

## Limites

O escopo corrige numeração concorrente e evita enfileirar uma ficha antes da confirmação do pedido. Não altera a segurança global, não renumera pedidos antigos e exige que todos os aparelhos atualizem para a versão nova antes de fechar pedidos ao mesmo tempo.
