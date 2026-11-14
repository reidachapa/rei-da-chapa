# Ingredientes: marcas e saldo físico

O usuário quer marca/subcategoria no cadastro e no item da compra, preservando o nome principal. Quer ver a quantidade adquirida, informar o saldo bom contado e as perdas do período, usando referência 1 na receita quando não conhece o peso por uso. As notas existentes são intocáveis.

## Abordagem

Reutilizar `marca`, `nomeBase`, `estoqueEstimado` e o modelo de média por contagem. O catálogo continua agregado pelo ingrediente principal; marca é metadado, sem criar saldos independentes. Não reconstruir estoque pela soma de notas históricas: isso ignoraria consumo e perdas. Não exibir as sentinelas 9999/99999 usadas para liberar vendas.

Compras somam quantidades convertidas; saldo contado significa quantidade boa disponível agora. Uma perda nova informada na mesma contagem integra a diferença consumida, sem baixar o saldo contado novamente. Ex.: disponíveis 6kg, contados3,4kg, perda0,1kg: saldo3,4kg e consumo2,5kg. Perdas já registradas não são digitadas novamente. Se a contagem superar o disponível, pedir confirmação do ajuste e não aprender consumo negativo.

Separar unidade física e referência da receita. Antes de haver média, não interpretar referência1 como1kg. Manter modos com rendimento explícito e estoque controlado. Quantidades decimais sobrevivem a edição. Contagem absoluta concorrente com movimentação do mesmo ingrediente deve gerar conflito seguro, preservando o rascunho, em vez de somar deltas.

## Preservação

Nenhuma migração ou reconstrução do estoque no banco. Não alterar snapshots de notas nem restaurar estado antigo. Usar confirmação existente de gravação no servidor; só informar sucesso depois dela. Compras novas continuam com backup após confirmação. Histórico e itens de compras não são renomeados pelo cadastro atual.

Correção pontual confirmada pelo usuário: Ovo deve ser contado por unidade. Foi corrigido somente `unidadeEstoque` de kg para un no cadastro existente, com backup anterior, atualização sob bloqueio de linha e igualdade dos hashes de todo o restante do estado e das notas. A quantidade foi preservada; nenhuma nota foi regravada. A edição de notas respeita a unidade interna atual do catálogo, convertendo a unidade comprada, sem reimportar uma unidade antiga do snapshot.

## Verificação

Testar compras equivalentes kg/g, média, saldo líquido e perdas, edição decimal, reversões e concorrência. Verificar formulários em Chrome local com dados sintéticos; conferir o app publicado sem salvar registros de teste.
