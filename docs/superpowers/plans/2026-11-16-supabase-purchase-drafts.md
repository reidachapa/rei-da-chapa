# Retomada de rascunho de compra pelo Supabase

> Plano autorizado pela resposta do usuário: persistir o conteúdo de rascunho no Supabase e guardar localmente somente um identificador aleatório por aparelho.

**Goal:** Retomar rascunhos de compra após recarregar ou fechar o app, mantendo-os separados por aparelho.

**Architecture:** Reutilizar `public.estado` com uma linha independente por aparelho, loja e chave de rascunho; nunca escrever no registro `id = atual`. Salvar apenas o UUID do aparelho em `localStorage`; o conteúdo do rascunho fica no Supabase e na memória volátil durante a sessão. Não criar tabela nem alterar RLS.

**Tech Stack:** JavaScript no app existente, Supabase JS, tabela `public.estado`.

## Tarefas

- [x] Criar e validar UUID persistente por aparelho, sem salvar dados comerciais no armazenamento local.
- [x] Carregar os rascunhos daquele aparelho após a conexão com o Supabase e retomá-los após autorização do gerente.
- [x] Sincronizar alterações com debounce, confirmação visível de estado e erros explícitos; limpar o rascunho remoto somente após a nota ser confirmada.
- [x] Verificar sintaxe, diff e ausência de novos usos de armazenamento local para dados comerciais. Não executar testes automatizados.

## Restrições

- Não alterar notas lançadas, o registro principal `estado.id = 'atual'`, schema ou políticas RLS.
- Se Supabase ou o UUID persistente estiver indisponível, avisar e não afirmar que o rascunho foi salvo.
- Manter todo o conteúdo da compra fora de `localStorage` e `sessionStorage`.
