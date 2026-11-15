# Campos separados e gasto com patrimônio

O usuário pediu desconto e juros simultâneos no fechamento e no recebimento. Confirmou também exibir o gasto de patrimônio na própria tela e no DRE, como investimento separado. Autorizou publicar e desligar o PC após conferir a publicação.

## Decisões

- Dois campos em reais, lado a lado: Desconto e Juros. Cada campo mantém seu valor ao editar o outro.
- Recebimento mostra saldo original, desconto, juros e total. Cada ajuste fica discriminado na auditoria. Preservar taxa de entrega e pagamentos anteriores.
- Compatibilidade com dados já salvos e chamadas antigas do cálculo; não alterar notas de compra.
- Patrimônio mostra gasto histórico de aquisição de todos os bens cadastrados, inclusive baixados, e o valor dos bens não baixados separadamente.
- DRE apresenta os investimentos pela data da compra do bem, em seção própria, sem alterar despesas operacionais ou lucro calculado.
- Salvar/excluir patrimônio deve aguardar confirmação, impedir clique repetido e preservar formulário/dados após falha.

## Verificação e entrega

- [x] Testes dos cálculos com ambos os ajustes, centavos, saldo parcial e compatibilidade.
- [x] Testes das interfaces reais de fechamento e recebimento, falhas, concorrência e cancelamento.
- [x] Conferência visual local em 390 × 844, sem acesso a dados reais.
- [x] Testes e revisão de patrimônio e relatório no DRE.
- [x] Suíte completa, sintaxe e diff.
Entrega: confirmar a implantação e agendar o desligamento do PC após a publicação.
