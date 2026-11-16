# Impedir compras idênticas

Uma compra repetida não deve ser gravada nem somar o estoque outra vez. A comparação considera data, fornecedor, número da nota, linhas de itens, marcas, tipos, unidades, quantidades, custos e descontos efetivos. A ordem das linhas e metadados de gravação não distinguem notas. Mudar somente pagamento, observação ou categoria não transforma a mesma compra em outra.

A verificação local ocorre antes de qualquer alteração de preço ou estoque. A sincronização verifica novamente o estado candidato antes de cada UPDATE condicional. Assim, quando dois aparelhos tentam gravar a mesma compra com IDs diferentes, o primeiro pode confirmar e a segunda tentativa encontra a nota existente depois de reler o servidor.

Uma rejeição mantém o rascunho e informa a nota existente. Nenhuma duplicata histórica será apagada ou corrigida automaticamente, e alterações sem relação com compras continuarão funcionando mesmo se já houver duplicatas antigas. Uma edição mantém o próprio ID e só precisa da validação quando seu conteúdo muda.

Verificar com testes do comparador, pré-validação do salvamento real e duas sincronizações concorrentes contra um servidor em memória. Os testes não modificam notas reais.

O segundo problema relatado durante o trabalho é a opção de controle do ingrediente voltar após reload. Investigar separadamente o caminho de gravação e carregamento, preservar notas e saldos e acrescentar uma regressão antes da correção.

A investigação reproduziu sucesso prematuro no formulário de ingredientes: ele limpava os campos sem aguardar `salvar()`. O handler agora espera a confirmação, bloqueia cliques durante o envio e mantém os campos quando falha. A reversão local fica restrita ao ingrediente enviado e só acontece se ele não mudou nem foi confirmado. Troca de perfil durante o envio mantém as permissões.

Verificação final: 251 testes passaram, incluindo 15 cenários da sincronização real com CAS em memória, 19 do comparador e 9 da persistência do ingrediente. As regressões foram observadas em RED antes das correções. Sintaxe dos 9 scripts inline e do módulo novo verificada. Nenhum dado real foi editado nos testes.

A validação de duplicidade é parte do aplicativo; todos os aparelhos precisam atualizar para executá-la. Não houve mudança de esquema, políticas ou registros no banco.
