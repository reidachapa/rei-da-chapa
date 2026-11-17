# Campos de compra para Ingrediente e Pão

## Objetivo

Na compra, mostrar para Produto, Ingrediente e Pão os campos de categoria, margem sobre custo e preço de venda, vinculando cada linha ao cadastro do mesmo tipo. Isso facilita atualizar o cadastro ao lançar a nota sem misturar custos de itens diferentes.

## Comportamento aprovado

- Produto mantém preço de venda e categoria atuais.
- Ingrediente usa `precoExtra` como preço do adicional no PDV e atualiza sua categoria existente.
- Pão ganha o campo `preco` no cadastro; sem preço anterior, o campo começa vazio. Custo e estoque continuam sendo calculados pelo fluxo atual de compra.
- Margem e preço são projetados usando o custo médio do item correspondente, sem juntar Produto, Ingrediente e Pão de mesmo nome.
- A seleção de nome continua apenas vinculando a linha ao cadastro. Não regrava notas antigas nem altera outro item.
- Nenhuma mudança de esquema, política RLS ou dados reais do Supabase.

## Alternativas consideradas

1. Reutilizar o preço de Produto em todos os tipos: rejeitada porque o ingrediente tem preço de adicional e Pão não tinha campo de preço próprio.
2. Exibir os campos sem persistir preço/categoria: rejeitada porque a atualização não chegaria ao cadastro do estoque.
3. Persistir por tipo, respeitando os campos do catálogo: escolhida por manter o vínculo e os cálculos de cada tipo separados.

## Limites

O preço próprio do Pão é guardado no cadastro e mostrado no estoque; ele não altera o preço do sanduíche, que continua definido pelo Produto vendido no PDV.
