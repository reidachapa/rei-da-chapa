# Precisão de custo médio e margem na compra

## Objetivo

Deixar visíveis valores mais precisos de custo médio e margem de lucro ao projetar preços de venda durante o lançamento de uma compra, sem mudar a regra financeira do preço de venda em centavos.

## Comportamento

- O custo médio e a margem serão formatados com no mínimo 2 e no máximo 4 casas decimais; zeros finais desnecessários não aparecem.
- O cálculo interno continuará usando a precisão numérica completa.
- O preço de venda continuará arredondado a centavos.
- Cada produto continuará recebendo seu próprio custo, desconto e margem, sem usar os valores de outra linha.
- O resumo monetário da nota continuará no padrão de moeda com 2 casas.
- Nenhuma gravação, sincronização, compra ou ajuste de estoque no Supabase faz parte desta mudança.

## Cenário de validação

1. Produto A: 5 unidades a R$ 100,00 por unidade; desconto do item de 10%; margem de 80%. Resultado esperado: custo médio R$ 90,00/unidade e preço de venda R$ 162,00.
2. Produto B: 4 unidades a R$ 13,33 por unidade; desconto do item de 7%; margem de 37,5%. Resultado esperado: custo médio R$ 12,3969/unidade e preço de venda R$ 17,05.
3. O desconto total esperado é R$ 53,7324 antes da apresentação do total monetário em centavos.

## Arquivos

- `index.html`: adicionar a formatação de precisão e usá-la nos campos de margem e custo médio projetado.
- `tests/purchase-pricing.test.cjs`: proteger o cálculo isolado dos dois produtos e dos descontos.
- `tests/purchase-margin-precision.test.cjs`: proteger a apresentação de até 4 casas decimais em pt-BR.
