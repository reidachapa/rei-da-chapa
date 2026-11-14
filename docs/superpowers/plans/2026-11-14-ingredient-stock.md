# Ingredientes: marcas e contagem Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Preserve existing notes and verify real behavior before claiming completion.

**Goal:** Exibir marcas e saldo físico confiável nos ingredientes e no PDV.

**Architecture:** Módulo puro `ingredient-stock.js` para conversões e reconciliação; integrar aos fluxos existentes no `index.html`, sem mudar esquema ou regravar dados atuais.

**Tech Stack:** JavaScript, HTML/CSS, Node test runner, Chrome, Supabase existente.

**Spec:** `docs/superpowers/specs/2026-11-14-ingredient-stock-design.md`.

## Global Constraints

- Notas e snapshots existentes são intocáveis.
- Marca é opcional e separada do nome; cadastro agregado pelo ingrediente.
- Sem controle libera vendas, mas exibe saldo conhecido e unidade real.
- Contagem é saldo bom líquido; perda não é abatida duas vezes.
- Sem mudanças diretas de dados atuais no Supabase.

## Review Focus

- Edição de nota antiga após renomear cadastro preserva o rótulo original.
- Contagem e venda simultâneas não somam saldo absoluto como movimento.
- Edição de valores0,2 não perde decimal.
- Referência1 não equivale a1kg antes da média.
- Perda excluída depois de uma contagem não aumenta saldo físico contado.

## Tasks

- [x] Teste vermelho e correção do lookup/gravação da marca na compra; autocomplete ordenado.
- [x] Testes vermelhos de conversão, contagem, perda e reversão; módulo puro e integração.
- [x] Testes vermelhos da concorrência; rejeitar contagem absoluta concorrente.
- [x] Corrigir formulário decimal e mostrar saldo/marca no cadastro e no PDV; modal de contagem com unidade e perda.
- [x] Rodar suíte completa, sintaxe e formulários no Chrome local; revisão independente.
- [ ] Criar PR, publicar conforme autorização e verificar app disponível, sem gravar testes no servidor.
