# Publicar na Play Store — o que falta, de verdade

Duas auditorias externas trataram este assunto como questão de *screenshots e
texto de loja (ASO)*. **Não é.** Os itens abaixo impedem o envio de chegar à
revisão; nenhum deles tem a ver com marketing.

---

## 1. Política de privacidade ✅ FEITO

O Google **recusa o envio** de app sem política de privacidade em URL
pública, e aplica rigor extra quando o app declara `ACCESS_FINE_LOCATION`
junto de `FOREGROUND_SERVICE_LOCATION` — exatamente o caso do KiteNinja, cujo
rastreio de downwind precisa continuar com a tela apagada.

**Publicada em `/privacidade`** (`app/privacidade/page.tsx`), pública, sem
login. O conteúdo descreve o que o código realmente faz: as permissões vieram
do `AndroidManifest`, as categorias de dado das tabelas de `lib/schema.sql`, e
o prazo de 7 dias é o mesmo da purga em `resumirEPurgar`.

URL para colar no formulário do Play Console:
`https://kiteninja.vercel.app/privacidade`

> Se o app passar a coletar algo novo, **esta página muda junto**. Uma
> política que descreve outro app é pior que nenhuma.

---

## 2. `assetlinks.json` ⚠️ FALTA UM VALOR SEU

O arquivo existe em `public/.well-known/assetlinks.json` com tudo preenchido
**menos a impressão digital do certificado** — que só pode sair do seu
keystore, e keystore não entra em repositório.

Sem esse arquivo servido corretamente, links do app abrem com a barra do
navegador por cima, em vez de abrirem como aplicativo.

### Como obter a impressão

**Se você já assina com um keystore local:**

```bash
keytool -list -v -keystore <caminho-do-seu-keystore.jks> -alias <seu-alias>
```

Copie a linha `SHA256:` (o valor com dois-pontos entre os bytes).

**Se usa o Play App Signing** (o padrão hoje, e o recomendado): a impressão
que vale é a **do Google**, não a sua. Ela está em:

> Play Console → seu app → **Configuração** → **Integridade do app** →
> **Assinatura de apps** → *Certificado de assinatura de apps* → `SHA-256`

> ⚠️ Usar a impressão errada é a causa nº 1 de "configurei e não funcionou".
> Com o Play App Signing ativo, a sua chave de upload **não** é a que vale.

### Onde colar

Substitua o texto `SUBSTITUIR_PELA_IMPRESSAO_SHA256_DO_KEYSTORE_DE_RELEASE`
em `public/.well-known/assetlinks.json` e faça o deploy.

### Como conferir

```bash
curl -s https://kiteninja.vercel.app/.well-known/assetlinks.json
```

Tem que devolver o JSON (não uma página de erro), com `content-type` de JSON.
O validador oficial do Google também confere:
`https://developers.google.com/digital-asset-links/tools/generator`

---

## 3. Formulário de Segurança de Dados

O Play Console pede uma declaração item a item. O que responder, de acordo
com o que o código faz:

| Pergunta | Resposta |
|---|---|
| Coleta localização precisa? | **Sim** |
| Em segundo plano? | **Sim** — rastreio de downwind com a tela apagada |
| Por quê? | Funcionalidade do app + segurança (SOS) |
| É compartilhada com terceiros? | **Não** |
| É criptografada em trânsito? | **Sim** (HTTPS) |
| O usuário pode pedir exclusão? | **Sim** — por e-mail, e a exclusão é em cascata |
| Coleta e-mail e nome? | **Sim** — gestão de conta |
| Coleta mensagens? | **Sim** — chat e mensagens diretas |
| Publicidade ou perfilamento? | **Não** |

---

## 4. Declaração de localização em segundo plano

Porque o app usa `FOREGROUND_SERVICE_LOCATION`, o Google pede uma
justificativa escrita e, em geral, **um vídeo curto** mostrando o recurso em
uso.

Texto sugerido para o formulário:

> O KiteNinja é usado por praticantes de kitesurf durante travessias de
> downwind, que duram horas em mar aberto. Durante uma travessia iniciada pelo
> próprio usuário, o app registra a posição em segundo plano para que os
> outros participantes e a equipe de apoio em terra saibam onde cada velejador
> está. É um recurso de segurança: se alguém para de reportar posição, o grupo
> é alertado e sabe onde procurar. O rastreio só ocorre durante uma travessia
> ativa e é encerrado junto com ela.

O vídeo precisa mostrar: iniciar o downwind, o app ir para segundo plano, e a
posição continuar aparecendo para outro participante.

---

## 5. Ícones e capturas de tela

Aqui sim é a parte de loja: ícone 512×512, gráfico de destaque 1024×500 e ao
menos duas capturas por formato. **É o último item, não o primeiro** — sem os
quatro anteriores o envio nem é aceito.

---

## Ordem recomendada

1. ~~Política de privacidade~~ ✅
2. Impressão SHA-256 → `assetlinks.json` → deploy → conferir com `curl`
3. Formulário de Segurança de Dados
4. Declaração de localização em segundo plano + vídeo
5. Ícones e capturas

Os itens 2 a 4 dependem de acesso ao Play Console e ao keystore, que são
seus. O item 1 está pronto.
