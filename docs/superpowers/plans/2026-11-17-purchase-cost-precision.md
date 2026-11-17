# Plano: precisão na prévia de compras

## Tarefa 1 — Reproduzir o cálculo por item

- Arquivo: `tests/purchase-pricing.test.cjs`.
- Adicionar um caso com os dois produtos, os descontos e as margens especificadas.
- Verificar custo médio, margem, preço de venda e desconto total com valores literais.
- Executar o teste e observar a falha, se houver.

## Tarefa 2 — Proteger a apresentação

- Arquivo: `tests/purchase-margin-precision.test.cjs`.
- Exercitar a função real de formatação da tela para valores inteiros e fracionários.
- Exigir até 4 casas decimais em pt-BR, preservando zeros mínimos de moeda/percentual.
- Confirmar a falha antes de implementar.

## Tarefa 3 — Implementar formatação

- Arquivo: `index.html`.
- Criar helper de formatação com até 4 casas, sem tocar na matemática nem no preço arredondado em centavos.
- Usar o helper para o custo médio projetado e a margem exibida.

## Tarefa 4 — Verificar

- Rodar os testes de precificação, margem e desconto.
- Revisar o diff e confirmar que nenhuma integração com Supabase ou estoque foi alterada.
