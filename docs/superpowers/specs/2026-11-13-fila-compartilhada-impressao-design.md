# Fila compartilhada de impressão — desenho

## Intenção

Permitir que pedidos criados em qualquer celular ou no PC entrem na mesma fila. O aparelho que estiver conectado à impressora consome os trabalhos em ordem, um por vez, sem precisar trocar a impressora de aparelho a cada pedido.

## Estado atual

- O app guarda os dados da loja no registro único `public.estado`; cada aparelho mantém a própria conexão em `printerState`.
- A impressão atual envia o ticket diretamente pelo aparelho que recebeu o comando. O PC usa Web Serial/COM ou USB; o celular usa uma integração Bluetooth disponível no próprio aparelho.
- A GS-MTP5 é Bluetooth clássico SPP. O usuário já tem o app Bluetooth Print/Thermer para Android, que informa suporte de impressão para sites.
- O projeto ainda não tem uma fila persistida compartilhada.

## Objetivos

- Enfileirar ticket de pedido novo, alteração e reimpressão, mantendo a ordem de criação no servidor.
- Deduplicar acionamentos repetidos do mesmo evento; uma reimpressão solicitada pelo operador recebe uma chave nova.
- Permitir que PC ou celular Android seja a estação ativa, com somente uma estação processando trabalhos por loja.
- Manter trabalhos pendentes quando a estação ou a conexão cai. Um estado incerto exige conferência antes de reenviar para evitar duplicatas silenciosas.
- Isolar a fila em tabelas novas para que enfileirar/atualizar impressão não altere o JSON de `public.estado`, compras, estoque ou pedidos.

## Fora do escopo

- Emissão de NFC-e/cupom fiscal.
- Refazer a autenticação ou a política existente de `public.estado`.
- Garantir impressão sem interação do Android antes de testar o modo de integração do Bluetooth Print com a GS-MTP5.

## Abordagens

1. **Uma fila em Supabase e uma estação ativa por loja — recomendada.** Cada aparelho grava o trabalho uma vez. A estação PC envia pelo canal serial já existente; a estação Android encaminha para o Bluetooth Print/Thermer. A fila guarda estado e permite retomar após queda. É o único caminho que atende PC e celular sem trocar de aparelho a cada pedido.
2. **Impressão somente pelo PC.** Mais simples e usa o caminho Web Serial/COM, mas o celular apenas envia para a fila e não pode imprimir quando o PC não estiver disponível.
3. **Conexão direta de todos os celulares à impressora.** Não cria uma fila compartilhada e depende do pareamento/conexão do modelo, portanto não atende ao fluxo solicitado.

## Decisões propostas

- Criar tabelas separadas `public.fila_impressao` e `public.fila_impressao_estacoes`, com RLS habilitado e as permissões anônimas amplas que o app sem login usa atualmente. Essa autorização não restringe as linhas por loja e fica para a etapa futura de segurança.
- Guardar na fila metadados do pedido e um snapshot mínimo e imutável apenas dos campos usados na comanda (itens, cliente/entrega, observação e totais), para cada evento sair com o conteúdo que existia quando foi solicitado. O payload é apagado depois da confirmação, mantendo metadados de deduplicação.
- Consultar a fila no Supabase a cada 2,5 segundos enquanto a estação está ativa; sem alterar a publicação Realtime existente.
- Usar uma reserva temporária por loja e bloquear a linha da estação durante a reivindicação; só pode haver um trabalho `imprimindo` por loja, inclusive durante a troca de estação. Se uma estação morrer durante um envio, marcar o trabalho como `conferir` ao expirar a reserva; não o reenviar automaticamente.
- No PC, usar a conexão serial/USB existente e permitir impressão automática pela estação. No Android, abrir a janela nativa de impressão para selecionar Bluetooth Print/Thermer; confirmar manualmente cada ficha antes de marcá-la como impressa.
- Não aplicar nenhuma mudança na linha de dados existente nem alterar as policies de `public.estado`.

## Critérios de aceite

- Pedidos criados em dois aparelhos aparecem na mesma fila em ordem e imprimem um por vez pela estação ativa.
- Repetir o mesmo salvamento não cria um segundo ticket; “Reimprimir” cria um trabalho novo.
- Alterações no pedido criam um ticket de alteração associado ao pedido.
- Sem estação conectada, os trabalhos continuam pendentes; voltar à tela ou reconectar não apaga a fila.
- Falha/queda deixa o trabalho visível para conferência ou tentativa manual, sem reenviar silenciosamente um ticket possivelmente já impresso.
- `public.estado` e seus dados não são regravados para transportar a fila.

## Limites conhecidos

- Não há como validar fisicamente a GS-MTP5 nesta sessão. A janela de impressão do Android, a seleção do Bluetooth Print/Thermer e a confirmação de cada papel precisam ser conferidas pelo usuário quando tiver a impressora em mãos.
- O envio por Bluetooth confirma a entrega dos bytes ao transporte, não a presença de papel impresso; por isso estados de falha durante o envio precisam de confirmação humana.
- A fila nova segue o modelo de acesso anônimo já usado pelo app; a revisão geral de segurança permanece fora deste trabalho.
