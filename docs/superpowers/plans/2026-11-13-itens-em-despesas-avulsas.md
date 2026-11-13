# Itens em despesas avulsas Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan inline. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar detalhamento de itens a despesas avulsas e provar que o total segue corretamente para o DRE.

**Architecture:** A interface, o modelo de dados, o DRE e a exportação continuam no `index.html`, reaproveitando os estilos de linha de compra sem reutilizar o fluxo que movimenta estoque. `despesas[].valor` permanece o valor contábil autoritativo, e funções compartilhadas calculam totais e mantêm despesa avulsa separada de compra na tela e no Excel.

**Tech Stack:** HTML, CSS e JavaScript já existentes; testes Node.js com `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-11-13-itens-em-despesas-avulsas.md`

## Global Constraints

- Não alterar estoque, PDV, dados antigos, banco ou políticas RLS.
- Registros antigos sem itens continuam com valor manual e podem ser editados.
- Despesas itemizadas gravam a soma em `valor` para o DRE somar uma vez.
- Depois de validar e revisar, publicar via PR, conforme autorização explícita do usuário nesta conversa.

## Review Focus

- Despesa antiga sem linhas: valor manual não deve ser zerado ao editar.
- Linha adicionada sem preenchimento: salvar não pode descartar silenciosamente um valor digitado.
- Quantidade fracionária: subtotal deve manter a precisão monetária esperada.
- Despesa itemizada sem vínculo: DRE deve classificá-la como operacional.
- Compra com movimento de estoque: classificação existente no DRE deve continuar igual.
- Despesa itemizada no Excel: manter em Gastos e fora da planilha de itens de compras.

---

### Task 1: Formulário de despesa itemizada e DRE

**Files:**
- Modify: `index.html`
- Create: `tests/expense-items-dre.test.cjs`
- Create: `docs/superpowers/specs/2026-11-13-itens-em-despesas-avulsas.md`

**Interfaces:**
- Produz `calcularTotalItensDespesaAvulsa(itens)`, que soma `qtd * valor` das linhas.
- Produz `separarDespesasDRE(despesas)`, que retorna `{ comprasEstoque, despesasOperacionais }` usando a regra atual de vínculo/movimento de estoque.
- Produz `despesaEhCompraExcel(despesa)`, que prioriza `tipoRegistro` e não trata itens de despesa como compras.
- O registro de despesa avulsa persiste os itens na propriedade `itens` e a soma em `valor`.

- [ ] **Step 1: Escrever testes regressivos para totais de itens, edição compatível e classificação no DRE.**
- [ ] **Step 2: Executar `node tests/expense-items-dre.test.cjs` e confirmar falha por funcionalidade ausente.**
- [ ] **Step 3: Implementar editor de linhas opcional, preservar valor manual sem linhas, exibir prévia dos itens e usar `separarDespesasDRE` no DRE.**
- [ ] **Step 4: Executar o teste específico e depois todos os `tests/*.test.cjs` com Node.**
- [ ] **Step 5: Revisar diff, criar PR e publicar após os checks aprovados.**
