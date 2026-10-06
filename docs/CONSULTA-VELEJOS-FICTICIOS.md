# Velejos gravados com os valores fictícios do formulário antigo

Até `9ac4480` (06/10/2026), o formulário "Registrar Velejo" abria já
preenchido com **28,4 km**, **salto de 9,2 m**, velocidade 50, vento 20 e
rajada 26. Quem registrava à mão sem apagar esses campos gravava esses números.
Os valores aparecem no feed e no Diário, e entram na distância total do
perfil (`/api/auth/me`) e no "Max Salto" do Diário.

Este ambiente não tem acesso ao banco de produção. As consultas abaixo são
para o dono rodar no **SQL Editor do Neon** (console.neon.tech → projeto →
SQL Editor). Rodar uma consulta acorda o banco por alguns minutos — custo
desprezível no plano Free.

## 1. Contar (só leitura — rode esta primeiro)

A assinatura usada é **distância 28,4 E salto 9,2 ao mesmo tempo**. O GPS
nunca grava salto (o prefill o zera), e a coincidência exata dos dois por
acaso é improvável. Velocidade não entra no filtro: o campo já foi em nós e
depois em km/h, então o valor gravado mudou ao longo do tempo.

```sql
SELECT
  COUNT(*)                         AS velejos_suspeitos,
  COUNT(DISTINCT user_id)          AS velejadores_afetados,
  MIN(created_at)                  AS primeiro,
  MAX(created_at)                  AS ultimo
FROM sessions_log
WHERE distance_km = 28.4
  AND highest_jump_m = 9.2;
```

Para ver quais são (sem mexer em nada):

```sql
SELECT s.id, u.name, s.spot_name, s.date, s.avg_wind_knots, s.max_gust_knots,
       s.distance_km, s.max_speed_knots, s.highest_jump_m, s.created_at
FROM sessions_log s
JOIN users u ON u.id = s.user_id
WHERE s.distance_km = 28.4
  AND s.highest_jump_m = 9.2
ORDER BY s.created_at DESC;
```

## 2. Limpar (só depois de olhar a lista acima — decisão do dono)

Apaga **apenas os números inventados** (distância, velocidade, salto), deixando
o velejo, as fotos, curtidas e comentários. Vento médio fica, porque a coluna
é obrigatória e não há como saber o valor verdadeiro; rajada 26 é zerada só
quando veio junto com o vento 20 padrão.

```sql
UPDATE sessions_log
SET distance_km = NULL,
    max_speed_knots = NULL,
    highest_jump_m = NULL,
    max_gust_knots = CASE WHEN avg_wind_knots = 20 AND max_gust_knots = 26
                          THEN NULL ELSE max_gust_knots END
WHERE distance_km = 28.4
  AND highest_jump_m = 9.2
RETURNING id;
```

O filtro (`WHERE`) é idêntico ao da seção 1, então o número de linhas
devolvidas deve bater com a contagem. O editor do Neon grava na hora — não há
"desfazer" depois; por isso a lista vem antes. (O Neon permite restaurar o
banco a um instante anterior, mas no plano Free essa janela é curta — confira
o limite no console antes de contar com ela.)

Se algum velejador realmente fez 28,4 km e saltou 9,2 m no mesmo dia, ele
perde esses dois números — por isso a lista da seção 1 vem antes.
