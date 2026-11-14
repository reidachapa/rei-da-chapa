# Categorias Financeiras e Abastecimento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar as categorias financeiras pesquisáveis e editáveis e registrar abastecimentos com NF, litros, preço por litro e total correto no DRE.

**Architecture:** As mudanças permanecem no `index.html`, mantendo o `select` atual como valor canônico para a lógica de notas e despesas e adicionando uma interface escura de busca por cima. O formulário avulso guarda NF e abastecimento no próprio registro; `despesas[].valor` continua sendo o total contábil único usado pelo DRE.

**Tech Stack:** HTML, CSS e JavaScript do app; testes existentes em Node.js com `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-11-13-categorias-financeiras-abastecimento.md`

## Global Constraints

- Preservar as categorias financeiras atuais e a edição/renomeação; ordenar categorias por nome em português.
- Preservar notas, despesas, rótulos históricos, itens e estoque; não alterar categorias de estoque/PDV.
- Não alterar schema, dados diretamente no Supabase, políticas RLS ou login.
- O total da despesa é contado uma única vez; litros e preço/L são dados de conferência e cálculo.
- Permitir R$ 0,00 quando não há valor manual; categorias e campos de combustível não apagam nem reclassificam lançamentos existentes.

## Review Focus

- Categoria com diferença apenas de caixa/acentos não deve duplicar nem se ordenar errado; testar normalização e ordem.
- Rótulos de categorias antigas devem permanecer nos registros, e uma categoria nova criada no campo deve aparecer nos dois formulários e no estado sincronizado; testar preservação e cadastro.
- Litros e preço com vírgula decimal devem calcular corretamente, por exemplo 2,475 × R$ 6,09 → R$ 15,07; campos incompletos ou valor manual vazio/zero devem salvar sem esconder o lançamento.
- DRE deve mostrar despesa com valor zero por categoria, somar combustível e itens uma única vez e manter compra de estoque separada; testar esses totais e classificações.
- O campo de busca e o formulário de abastecimento devem continuar fáceis de usar no celular e no computador; revisar toque, teclado, foco e a aparência escura no navegador.

---

### Task 1: Campo de categoria financeira pesquisável

**Files:**
- Modify: `index.html`
- Create: `tests/expense-financial-categories.test.cjs`

**Interfaces:**
- Produz `normalizarCategoriaFinanceira(nome)`, que remove acentos, normaliza caixa e espaços para comparar nomes sem alterar o rótulo exibido.
- Produz `ordenarCategoriasFinanceiras(categorias)`, que devolve as categorias em ordem alfabética pt-BR sem remover nem renomear as existentes.
- Produz `garantirCategoriaFinanceira(nome, emoji)`, que reutiliza uma categoria equivalente ou cria uma nova no catálogo atual, atualizando as opções de compra/despesa e salvando pelo mecanismo existente.
- O campo pesquisável atualiza o `select` canônico para manter compatibilidade com formulários e notas históricas.

- [x] **Step 1: Escrever testes que provem ordenação, equivalência sem acento/caixa, preservação das categorias atuais e cadastro de uma categoria nova.**
- [x] **Step 2: Executar `node tests/expense-financial-categories.test.cjs` e confirmar falha pela ausência do comportamento.**
- [x] **Step 3: Implementar a interface pesquisável escura para os campos financeiros de compra e despesa avulsa, mantendo criação/edição/exclusão no gerenciador e ordenando sua lista.**
- [x] **Step 4: Executar o teste específico e corrigir até passar; teclado, foco e estilos revisados no código. A conferência visual no navegador ficou indisponível: a automação do navegador isolado não acessou localhost e o Computer Use encerrou ao não conseguir identificar a URL do Chrome.**

### Task 2: Dados de abastecimento, NF, valor zero e DRE

**Files:**
- Modify: `index.html`
- Create: `tests/expense-fuel-fields-dre.test.cjs`

**Interfaces:**
- Produz `calcularTotalAbastecimento(litros, precoPorLitro)`, que interpreta números decimais em formato brasileiro e devolve valor arredondado a centavos quando os dois campos são informados.
- O registro de despesa avulsa persiste `nf` e `abastecimento: { litros, precoPorLitro }`; campos opcionais ausentes não bloqueiam o salvamento e o total pode ser zero. Se combustível e itens avulsos forem informados juntos, o total soma cada detalhe uma vez.
- O DRE e a lista de despesas exibem categoria e detalhes informados, sem somar NF/litros como valores adicionais.

- [x] **Step 1: Escrever testes para cálculo arredondado, preenchimento de `nf` e `abastecimento`, salvamento com valor zero, exibição/categoria no DRE e total contado uma vez.**
- [x] **Step 2: Executar `node tests/expense-fuel-fields-dre.test.cjs` e confirmar falha pelas funções/campos ausentes.**
- [x] **Step 3: Adicionar campos opcionais de NF, litros e preço/L; mostrar abastecimento para categorias correspondentes e calcular o valor quando ambos forem preenchidos. Deixar o valor manual opcional e aceitar zero.**
- [x] **Step 4: Mostrar os detalhes no histórico de despesas e no DRE, mantendo a classificação do DRE por categoria e o valor autoritativo único.**
- [x] **Step 5: Executar os dois testes específicos e todos os `tests/*.test.cjs`; revisar diff e sintaxe dos scripts inline.**

### Task 3: Revisão final e publicação

**Files:**
- Review: `index.html`, os dois testes e este plano.

- [x] **Step 1: Conferir que o diff não altera estoque/PDV, histórico ou schema/RLS do Supabase.**
- [ ] **Step 2: Abrir a interface no navegador em largura de celular e computador, confirmar busca escura, layout de combustível e DRE com valor zero.**
- [ ] **Step 3: Criar PR contra `main`, acompanhar os checks e mesclar/publicar após validação, autorizado pelo usuário nesta conversa.**




