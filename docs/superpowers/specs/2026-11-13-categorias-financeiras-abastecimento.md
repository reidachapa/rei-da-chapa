# Categorias financeiras e abastecimento

## Intenção
Facilitar o lançamento e a edição de despesas, registrar os dados de abastecimento e mostrar os gastos de um jeito claro no DRE.

## Objetivos
- Manter todas as categorias financeiras atuais e permitir criar, renomear e excluir pelo gerenciador.
- Substituir a caixa branca por um campo escuro pesquisável com autopreenchimento; ordenar as sugestões e a lista do gerenciador alfabeticamente em português.
- Ao confirmar uma categoria digitada que ainda não existe, adicioná-la ao catálogo compartilhado para aparecer nas próximas despesas e nos demais aparelhos.
- No lançamento avulso, incluir o número da nota. Para categorias que indiquem posto, abastecimento ou combustível, exibir litros e preço por litro; quando ambos forem informados, calcular o total por litros × preço/L.
- Deixar o valor total opcional e aceitar R$ 0,00, inclusive para registrar um gasto antes de saber o valor.
- Mostrar as despesas por categoria no DRE; exibir abastecimento separadamente quando estiver em categoria própria, sem contar o total duas vezes.
- Preservar registros existentes, rótulos históricos, itens de despesas e estoque/PDV.

## Fora do escopo
- Alterar categorias de estoque/PDV, tabelas, RLS, login ou emitir documento fiscal.
- Reclassificar valores de lançamentos antigos.

## Abordagem
Foram consideradas duas opções: manter o seletor nativo e escurecer suas opções (menos mudança, mas busca e aparência variam por navegador) ou substituir por um campo pesquisável escuro ligado ao catálogo atual (busca e visual consistentes e permite cadastrar digitando). **Abordagem aprovada: campo pesquisável**, conforme o pedido de autopreenchimento e remoção do menu branco. O catálogo existente continua disponível e editável.

## Dados e comportamento
- Reutilizar as categorias e sincronização atuais do estado compartilhado; não limpar o catálogo e não criar migração/tabela no Supabase.
- Preservar a categoria original nos registros antigos. Mudanças futuras no nome/ícone da categoria não devem reescrever o rótulo já registrado.
- No formulário de despesa, salvar número da nota, litros e preço por litro no registro. Esses dois últimos campos são opcionais; se ambos estiverem preenchidos, o total reflete a multiplicação. Sem cálculo, o valor manual pode ficar vazio/zero e salvar.
- O DRE soma o campo `valor` uma vez e agrupa pela categoria. Os campos da bomba e da nota servem para conferência e não criam outro gasto.
- As linhas de despesa existentes permanecem independentes do estoque; seu total mantém o comportamento atual.
