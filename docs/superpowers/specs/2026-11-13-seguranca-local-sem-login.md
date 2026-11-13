# Endurecimento de segurança local sem login obrigatório

## Objetivo

Reduzir riscos que podem ser corrigidos no cliente e preparar uma migração SQL conservadora, mantendo o app sem senha obrigatória e preservando a sincronização atual entre aparelhos.

## Decisões e limites

- Corrigir a renderização de ícones e identificadores vindos de backups/estado compartilhado para que permaneçam dados inertes.
- Remover bytes de controle de campos textuais antes de enviá-los à impressora ESC/POS, mantendo quebras de linha e comandos do recibo que o próprio app gera.
- Preparar uma migração que remova grants de `INSERT`, `DELETE` e `TRUNCATE` desnecessários em `public.estado`; manter `SELECT` e `UPDATE` anon para não quebrar o uso sem login.
- Nas tabelas de fila, remover grants de `DELETE` e `TRUNCATE`; manter `SELECT`, `INSERT` e `UPDATE` usados pelo fluxo multiaparelho.
- Não aplicar migrações no Supabase, não publicar/mesclar e não adicionar autenticação obrigatória.
- Registrar claramente que a migração parcial não impede leitura nem alteração anon do JSON, e não isola a fila por loja. Correção completa depende de fronteira confiável por loja/dispositivo.

## Verificação

- Teste de regressão executa o encoder real contra ESC, GS, controles C0/C1, newline, texto acentuado e caractere fora de CP850.
- Testes de segurança verificam o escapamento HTML real e os sinks/atributos de dados conhecidos.
- Verificação estática da migração confirma grants preservados e ausência de operações que alterem linhas/dados.
- Executar os testes CJS do projeto e `node --check` nos scripts JavaScript.
