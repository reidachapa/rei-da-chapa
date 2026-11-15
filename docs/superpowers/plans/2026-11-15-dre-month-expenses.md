# DRE mensal e conferência das despesas

## Pedido e evidência

O usuário pediu Mês como período inicial e a manutenção de Hoje, Ontem, 7 dias, Mês, Ano e Tudo. Também autorizou criar despesas temporárias, conferir a soma, excluir os testes antes da publicação e desligar o PC após a implantação.

A investigação reproduziu: filtro inicial Hoje; mês terminando amanhã; seletor sem meses que só tinham despesas/compras; ausência de Ano; datas ISO excluídas por concatenação com T12; e, no navegador, o botão Nova despesa do DRE abrindo indevidamente Registrar compra.

## Implementação

- [x] Módulo de datas testável com datas civis locais, ISO, meses completos e ano completo.
- [x] Mês ativo ao iniciar; seis filtros rápidos e seletor com meses de todos os lançamentos financeiros.
- [x] Classificação explícita de despesas e compras, preservando o tratamento de compras de estoque fora da despesa operacional para evitar duplicação do CMV.
- [x] Datas consistentes no filtro, detalhe e resumo diário das despesas.
- [x] Nova despesa abre o formulário correto, sem acionar os monitores antigos de compra.
- [x] Testes automatizados, sintaxe e conferência completa no aplicativo local conectado ao banco.

## Teste autorizado e limpeza

Foram criadas três despesas claramente identificadas como temporárias: paga R$ 1,23, pendente no último dia do mês R$ 2,34 e itemizada 2 × R$ 3,00. O aplicativo mostrou R$ 9,57 no mês e R$ 7,23 em Hoje. O filtro Ano também incluiu os três lançamentos. A nova ação Nova despesa foi verificada no navegador.

O navegador travou no diálogo de exclusão. A limpeza foi feita pelo conector Supabase, com operação atômica que removeu somente os três pares exatos de ID/descrição. A consulta final confirmou zero testes restantes, os 17 lançamentos reais então existentes preservados e igualdade dos demais dados da loja. Nenhuma migração ou alteração de notas existentes foi feita.

Entrega: concluir revisão independente, publicar, conferir o site e só então desligar o PC.
