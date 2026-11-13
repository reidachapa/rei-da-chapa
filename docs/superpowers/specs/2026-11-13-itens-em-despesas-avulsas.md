# Itens em despesas avulsas

## Objetivo

Permitir detalhar uma despesa avulsa em várias linhas, como o lançamento de itens de uma compra, e manter o valor total correto no DRE.

## Comportamento

- O formulário de despesa avulsa permite adicionar, alterar e remover linhas com nome, quantidade e valor unitário.
- O total de cada linha é quantidade × valor unitário. Quando há linhas preenchidas, o total da despesa é a soma dessas linhas.
- A descrição, categoria, data, status e observação continuam disponíveis no lançamento.
- Despesas antigas sem itens continuam editáveis e preservam o valor manual. Não são criadas linhas artificiais ao abrir um registro antigo.
- Linhas de despesa são apenas detalhamento financeiro e não movimentam estoque nem PDV.
- O registro mantém o formato atual em `despesas`: `tipoRegistro: 'despesa'`, `itens` com as linhas e `valor` com o total. Não é necessária migração nem escrita no Supabase além da sincronização já existente.
- A lista de despesas mostra uma prévia dos itens para facilitar conferência.
- No DRE, uma despesa avulsa itemizada continua sendo despesa operacional e `valor` é contado exatamente uma vez. Compras com movimentação de estoque continuam classificadas como ativo/compra de estoque.
- A ação Editar na lista de despesas do DRE abre o formulário de despesa avulsa; compras continuam usando o formulário de compra.
- Na exportação Excel, despesa itemizada fica em Gastos e seus itens não entram na planilha de itens de compras.

## Verificação

- Testar o total de múltiplas linhas com quantidade e valores fracionários.
- Testar que linha itemizada sem vínculo de estoque permanece operacional no DRE.
- Testar que compra com movimento de estoque continua fora das despesas operacionais.
- Testar que o DRE abre a tela correta para editar cada tipo de lançamento.
- Testar que o Excel não classifica despesa itemizada como compra.
- Testar que o formulário persiste os itens e que despesas antigas sem itens preservam seu valor.
