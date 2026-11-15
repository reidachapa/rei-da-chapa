# Desconto e juros no pedido

**Objetivo:** alternar entre desconto e juros manuais em reais no fechamento do pedido e antes de receber uma dívida do cliente.

**Escolha de implementação:** manter os campos de desconto existentes e acrescentar `jurosPedido`, com cálculo centralizado em centavos. `subtotal` continua sendo a cobrança sem taxa de entrega; inclui os juros. Não calcular juros por tempo nem juros compostos automaticamente. As compras não participam deste fluxo.

**Comportamento:** o fechamento inicia em Desconto. A troca do botão altera o sinal aplicado ao valor informado. No recebimento, mostrar saldo anterior, ajuste e valor final antes de escolher a forma de pagamento. Simular/cancelar não altera o pedido. Confirmar salva ajuste, histórico e pagamento juntos. Descontos não reduzem o repasse de entrega. Um bloqueio impede confirmação repetida; falhas de gravação restauram os campos modificados.

## Execução

- [x] Testar o módulo real de cálculo com arredondamento, desconto, juros, taxa, saldo parcial, dados legados e entradas inválidas.
- [x] Integrar controles no fechamento e no recebimento, preservando valores antigos e recuperação de rascunho.
- [x] Mostrar juros em cartões, ficha, impressão e fila, mantendo total e lucro consistentes.
- [x] Testar recebimento, concorrência/conflito e cancelamento sem gravações reais; executar a suíte existente e verificar sintaxe/diff.
- [x] Revisar com um agente e preparar a atualização para publicação conforme autorização vigente.
