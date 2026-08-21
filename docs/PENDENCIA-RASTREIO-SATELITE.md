# Pendência — Rastreio via satélite (fora de área de cobertura)

Status: **pesquisa registrada, nada implementado.** Escrito em 21/08/2026 a
partir de uma pergunta do dono sobre segurança em downwind offshore, onde o
sinal de celular cai com frequência.

## A distinção que importa: captar posição vs. transmitir posição

**Captar a posição já funciona offline hoje, PWA ou nativo, sem mudança
nenhuma.** O GPS do celular recebe sinal de satélite GNSS direto — não
depende de internet nem de sinal de celular. `navigator.geolocation` (o que
`lib/usePositionBeacon.ts` e `lib/trilhaSessao.ts` usam) funciona com o
aparelho em modo avião, contanto que o GPS esteja ligado. **Isso não é o
gargalo.**

**O gargalo é transmitir** essa coordenada pro servidor, pra outros
velejadores/motorista verem. Isso exige alguma conexão de dados — Wi-Fi,
celular ou satélite-pra-celular. Sem nenhuma delas, o app não transmite nada
em tempo real, **PWA ou nativo — essa parte é igual nos dois formatos.** Ir
nativo (a decisão já registrada em `kiteninja-projeto.md`/memória, motivada
originalmente por background location) **não resolve sozinho** o problema de
satélite.

## As três formas reais de satélite, e o que cada uma exige

| Caminho | O que é | Exige nativo? |
|---|---|---|
| **Satélite-para-celular da operadora** (ex.: T-Satellite/Starlink Direct-to-Cell — já existe em algumas operadoras/regiões) | O celular ganha sinal de dados via satélite de forma transparente | **Não.** Pro app é só "internet disponível" — funciona igual em PWA e nativo, sem mudar uma linha de código. Depende só da operadora e do modelo do aparelho suportarem |
| **Dispositivo satelital dedicado** (Garmin inReach, Zoleo, SPOT) | Aparelho à parte, pareado por Bluetooth, que manda posição via satélite próprio | **Sim.** PWA não tem acesso a Bluetooth de baixo nível pra esse tipo de integração — exige app nativo (Capacitor, se for esse o caminho) + SDK do fabricante + o velejador possuir e levar o aparelho |
| **API de satélite da Apple** (a mesma do SOS por satélite do iPhone 14+) | Recurso de sistema para emergência/Localizar | **Não disponível pra terceiros.** A Apple não abriu essa API pra apps transmitirem dado arbitrário — só os próprios recursos do sistema usam |

## O que isso significa pra decisão de nativo vs. PWA

Reforça o que já estava registrado: pro problema específico de segurança em
água aberta sem sinal, **PWA tem o mesmo teto que nativo** — nenhum dos dois
resolve satélite sozinho fora de uma das três formas acima. A única vantagem
real do nativo aqui é poder integrar um Garmin/Zoleo via Bluetooth, que é a
via mais madura hoje pra offshore de verdade — mas exige hardware extra do
usuário, então não é algo que o app "ganha de graça" só por virar nativo.

## Mitigação barata, sem nenhuma das três (não implementada)

Guardar posições localmente (IndexedDB) quando a rede cair, e sincronizar
assim que a conexão voltar. **Não ajuda numa emergência durante o apagão de
sinal** (ninguém vê em tempo real, é o cenário que mais importa), mas evita
perder o trajeto pro resumo pós-travessia (`lib/downwindDb.ts`,
`resumirEPurgar`) — hoje, sem sinal, o ponto simplesmente não é gravado, fica
um buraco na trilha.

Se for implementar: `lib/useDownwindBeacon.ts`/`lib/trilhaSessao.ts` passam a
gravar num buffer local (IndexedDB, não `localStorage` — volume de pontos
numa travessia de horas pode ser grande) quando o `fetch` do POST falhar por
rede, e um efeito de reconexão (`online` event) esvazia o buffer contra
`/api/downwind/[id]/posicoes`, em lote, respeitando a ordem cronológica.

## Próximo passo, se o dono quiser seguir

Nenhuma ação de código até aqui — isto é registro de pesquisa. As decisões em
aberto, nesta ordem de impacto:

1. Vale investir na mitigação de buffer offline (barata, ajuda o resumo, não
   ajuda emergência ao vivo)?
2. Vale considerar integração com Garmin inReach/Zoleo como diferencial de
   segurança real, sabendo que isso empurra ainda mais a decisão pra nativo
   e exige o velejador ter o hardware?
3. Ou aceitar que, sem sinal de celular, o rastreio ao vivo simplesmente não
   existe por enquanto — e focar o esforço de segurança no que já existe
   (SOS, indicador de sinal do Modo Navegação) em vez de perseguir cobertura
   total?
