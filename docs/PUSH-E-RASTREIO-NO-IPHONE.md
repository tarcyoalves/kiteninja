# "Chega push do chat mas não do aviso" e "o iPhone rastreia com a tela apagada?"

Dois relatos que parecem o mesmo problema e não são. Um é de destinatário; o
outro é de plataforma.

## 1. O push do chat chega e o do aviso não

Não há defeito no envio. `sendPushToUser` já dispara Web Push (VAPID) **e** FCM
em paralelo, e é a MESMA função nos dois casos. A diferença é quem recebe:

| | Chat (DM) | Avisar a comunidade |
|---|---|---|
| Destinatário | a pessoa da conversa, direto | **os seguidores do organizador** |
| Precisa de quê | nada além do push ligado | **alguém seguir você** |

Quem avisa **não recebe o próprio aviso** (e não deveria). Então, testando com
duas contas em que a segunda não segue a primeira, o comportamento correto é
exatamente o relatado: nada chega.

Isso é decisão de produto, registrada na rota: o aviso vai para seguidores e
não para a base inteira, porque push de desconhecido é spam — e spam é o
caminho mais curto para o usuário desligar TODAS as notificações do app,
inclusive as de SOS.

### O que mudou para o relato não se repetir

A tela agora diz o que aconteceu, em três casos distintos:

- **sem seguidores** — "o aviso vai para quem SEGUE você; para chamar alguém
  específico, use o link de convite";
- **avisou, mas ninguém tem push ligado** — "avisamos N amigos no app (aparece
  no sininho deles); nenhum tem notificação do celular ligada";
- **já avisado** — o 409 do servidor aparece na tela em vez de sumir.

E o aviso deixou de depender de push: desde `2ffd0d8` ele também grava
notificação in-app (`downwind_novo`), que aparece no sininho de quem não tem
push. Ver o commit para o porquê.

## 2. O iPhone continua rastreando com a tela apagada?

**Não. E não é bug — é plataforma.**

O push chega com a tela apagada porque **quem entrega é o sistema
operacional**: o APNs acorda o service worker, a página não precisa estar viva.
O GPS não continua porque o **iOS suspende a página web** ao bloquear a tela, e
não existe API web que segure isso. Wake Lock só impede a tela de apagar
sozinha enquanto a página está visível; bloquear o aparelho na mão encerra tudo.

Rastreio com o app fora da tela só existe onde há **serviço nativo**. Neste
projeto existe um: o Foreground Service do Android
(`android/app/src/main/java/br/com/kiteninja/app/tracking/`). **Não há pasta
`ios/`** — no iPhone o app roda como PWA no Safari, e aí valem as regras acima.

| Cenário | Android (app instalado) | iPhone (PWA) |
|---|---|---|
| App aberto, tela acesa | rastreia | rastreia |
| Tela apagada | rastreia (serviço nativo) | **para** |
| App minimizado | rastreia (serviço nativo) | **para** |
| Push | chega | **chega** |

### O que foi corrigido agora

O app dizia **verde, "Localização sendo compartilhada"**, com a ressalva
"mantenha o app aberto e a tela acesa" em letra pequena embaixo. Verde quer
dizer "está tudo certo, pode ir" — e no iPhone isso vira falso no instante em
que a tela apaga. **O grupo achava que enxergava alguém que tinha sumido.**
Numa funcionalidade cuja razão de existir é ninguém ficar para trás na água sem
que se saiba, essa cor era a informação errada.

Agora, sem serviço nativo, o estado é **amarelo** e a condição está no título:
"Compartilhando só com a tela acesa" / "Se a tela apagar ou você sair do app, o
envio para". Amarelo não é alarme — é "funciona, com uma condição".

No Android com o serviço ativo continua verde, porque lá o verde é verdade.
Rebaixar os dois igualaria plataformas que não são iguais.

### A solução de verdade, se o iPhone importar

Empacotar o app para iOS com Capacitor (que já é usado no Android) e um plugin
de localização em segundo plano, declarando o background mode de "location
updates". Isso exige:

- conta de desenvolvedor Apple e uma máquina/CI com Xcode para o build;
- justificar o uso contínuo de localização na revisão da App Store — o caso
  aqui é forte (segurança de travessia marítima), mas é revisão;
- portar o equivalente do Foreground Service para o lado iOS.

É trabalho no app nativo, não neste repositório. Enquanto não existir, o
caminho honesto é o que está no ar: dizer com clareza que no iPhone o
rastreamento depende da tela acesa — e, para uma travessia de verdade, usar o
app Android ou levar um acompanhante com o link de apoio.
