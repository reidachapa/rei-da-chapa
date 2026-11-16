# Recuperação segura de rascunhos de compra

## Problema reproduzido

Na v1.0.43, uma gravação confirmada parcialmente mantém `savedNote`, mas conserva a `baseNota` anterior. A próxima tentativa compara a nota salva pelo próprio aparelho com essa base antiga e informa uma alteração de outro aparelho. Uma edição cuja nota foi excluída também mantém a identidade anterior, sem uma forma segura de retomada.

## Contratos

- Atualizar a base automaticamente apenas quando a nota enviada coincide com a cópia local e a cópia confirmada do servidor.
- Conflitos reais continuam bloqueados. Nenhum registro será substituído ou recriado automaticamente.
- Rascunhos de notas ausentes reabrem com todos os campos preservados e uma ação de conferência.
- A conferência lê o servidor novamente e apresenta a nota atual ou as candidatas de mesmo fornecedor, NF e data. O usuário prepara uma atualização ou uma compra nova, revisa e confirma no botão de salvar habitual.
- Preparar não grava no servidor. Uma compra nova recebe uma identidade nova; uma atualização parte da versão que foi conferida. As rotinas existentes de estoque, salvamento condicional e backup permanecem responsáveis pela gravação.
- Outros rascunhos, alterações pendentes e notas lançadas em outros aparelhos são preservados.
- Consultas descartam respostas se a nota aberta, a autorização, a loja, a revisão local ou a versão confirmada mudarem durante a leitura.
- Atualizações remapeiam os índices históricos dos itens usando a base anterior e a nota atual. Relações ambíguas interrompem a preparação para preservar contagens físicas e rótulos históricos.

## Verificação

Testes do módulo puro e da IIFE real cobrem confirmação própria, conflitos verdadeiros, retomada após reload, nota excluída/refeita, erro de consulta, estado local pendente e preservação dos dados digitados. Executar a suíte completa, verificar a sintaxe dos scripts e revisar o diff antes da publicação. Nenhuma nota real deve ser usada em testes de alteração ou exclusão.

As regressões reproduziram tanto o falso conflito após gravação própria quanto o aumento indevido de um saldo contado ao perder a referência histórica. A integração usa as rotinas reais de rascunho, aplicação de estado e salvamento, com Supabase simulado apenas para leitura. O fluxo dos botões de conferência também foi exercitado. A única consulta ao projeto nesta implementação foi um SELECT de verificação; não foram alterados registros reais ou políticas do banco.
