/**
 * Tábua de Marés Harmônica Local Calibrada para o Litoral Brasileiro (CHM / Marinha).
 *
 * O nível do mar bruto (MSL) fornecido por modelos meteorológicos globais tem resolução
 * de ~8km e representa anomalia do geoide médio. Para navegação e esportes náuticos
 * no Brasil, a referência oficial é o Zero Hidrográfico (Zero da Carta Náutica / DHN).
 *
 * Este módulo mapeia cada praia/spot para a estação maregráfica oficial mais próxima
 * e calibra o nível da água, a amplitude e a fase de preamar/baixamar.
 */

export interface EstacaoMaregrafica {
  id: string;
  nome: string;
  uf: string;
  lat: number;
  lng: number;
  nivelMedioM: number; // Altura do Nível Médio sobre o Zero Hidrográfico
  fatorAmplitude: number; // Multiplicador de maré de sizígia/quadratura
  descricao: string;
}

export const ESTACOES_MAREGRAFICAS_CHM: EstacaoMaregrafica[] = [
  {
    id: 'termisa-areia-branca',
    nome: 'Termisa / Areia Branca (Porto-Ilha)',
    uf: 'RN',
    lat: -4.83,
    lng: -37.03,
    nivelMedioM: 1.85,
    fatorAmplitude: 1.28,
    descricao: 'Referência náutica para Tibau, Grossos, Ponta do Mel e Porto do Mangue',
  },
  {
    id: 'macau-galinhos',
    nome: 'Porto de Macau / Galinhos',
    uf: 'RN',
    lat: -5.11,
    lng: -36.63,
    nivelMedioM: 1.88,
    fatorAmplitude: 1.3,
    descricao: 'Referência náutica para Macau, Galinhos, São Bento do Norte e Gostoso',
  },
  {
    id: 'porto-natal',
    nome: 'Porto de Natal',
    uf: 'RN',
    lat: -5.77,
    lng: -35.2,
    nivelMedioM: 1.62,
    fatorAmplitude: 1.22,
    descricao: 'Referência náutica para Natal, Maracajaú, Pipa e Baía Formosa',
  },
  {
    id: 'mucuripe-fortaleza',
    nome: 'Porto do Mucuripe (Fortaleza)',
    uf: 'CE',
    lat: -3.72,
    lng: -38.47,
    nivelMedioM: 1.7,
    fatorAmplitude: 1.25,
    descricao: 'Referência náutica para Cumbuco, Taíba, Paracuru, Jericoacoara e Preá',
  },
  {
    id: 'porto-cabedelo',
    nome: 'Porto de Cabedelo',
    uf: 'PB',
    lat: -6.97,
    lng: -34.83,
    nivelMedioM: 1.55,
    fatorAmplitude: 1.2,
    descricao: 'Referência náutica para o litoral da Paraíba e Barra de Camaratuba',
  },
  {
    id: 'porto-recife',
    nome: 'Porto do Recife',
    uf: 'PE',
    lat: -8.05,
    lng: -34.87,
    nivelMedioM: 1.48,
    fatorAmplitude: 1.18,
    descricao: 'Referência náutica para o litoral de Pernambuco e Maracaípe',
  },
  {
    id: 'luis-correia',
    nome: 'Porto de Luís Correia / Delta',
    uf: 'PI',
    lat: -2.88,
    lng: -41.67,
    nivelMedioM: 1.95,
    fatorAmplitude: 1.35,
    descricao: 'Referência náutica para Barra Grande, Coqueiro e Delta do Parnaíba',
  },
  {
    id: 'porto-itaqui',
    nome: 'Porto do Itaqui (São Luís)',
    uf: 'MA',
    lat: -2.57,
    lng: -44.37,
    nivelMedioM: 3.4,
    fatorAmplitude: 1.8,
    descricao: 'Referência para macro-marés do Maranhão e Lençóis Maranhenses',
  },
];

/**
 * Calcula a distância ortodrômica aproximada (em km) entre duas coordenadas.
 */
function distanciaKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c;
}

/**
 * Distância máxima entre um spot e a estação que pode calibrá-lo.
 *
 * POR QUE ISTO EXISTE
 *
 * A busca abaixo era "a estação mais próxima", sem teto. Como as estações
 * cadastradas cobrem só o Nordeste, o spot Praia Seca (Lagoa de Araruama, RJ)
 * era calibrado com o Porto do Recife — a **1.833 km** de distância — e o app
 * exibia 1,48 m de nível náutico para uma laguna hipersalina que, na prática,
 * quase não tem maré. Nenhum teste pegou: os três casos do arquivo de teste
 * usam spots do Nordeste, todos a menos de 90 km de uma estação.
 *
 * O valor de 250 km sai da medição, não do chute. Os 16 spots do Nordeste em
 * produção ficam entre 1 km e 181 km da estação mais próxima; o único fora da
 * faixa é o do Rio, a 1.833 km. 250 km cobre todos os legítimos com folga e
 * ainda rejeita o caso errado por quase uma ordem de grandeza.
 *
 * Fora do teto o app passa a não mostrar maré nenhuma. Num app de segurança
 * náutica, **ausência de dado é melhor que dado errado**: quem não vê maré vai
 * conferir na tábua da Marinha; quem vê 1,48 m confia no número.
 *
 * Para atender uma região nova, some uma estação real do CHM/DHN a
 * `ESTACOES_MAREGRAFICAS_CHM` — não aumente este teto.
 */
export const DISTANCIA_MAX_ESTACAO_KM = 250;

/**
 * Localiza a estação maregráfica oficial do CHM mais próxima da coordenada informada.
 *
 * Devolve sempre a mais próxima, por mais longe que ela esteja: esta é a
 * primitiva de "quem é a vizinha". Quem decide se essa vizinha está perto o
 * bastante para valer alguma coisa é `encontrarEstacaoMareParaSpot`.
 */
export function encontrarEstacaoMaregraficaMaisProxima(
  lat: number,
  lng: number
): EstacaoMaregrafica {
  let maisProxima = ESTACOES_MAREGRAFICAS_CHM[0];
  let menorDistancia = Infinity;

  for (const estacao of ESTACOES_MAREGRAFICAS_CHM) {
    const d = distanciaKm(lat, lng, estacao.lat, estacao.lng);
    if (d < menorDistancia) {
      menorDistancia = d;
      maisProxima = estacao;
    }
  }

  return maisProxima;
}

/**
 * A estação que pode legitimamente calibrar este spot, ou `null` se a mais
 * próxima estiver longe demais para dizer qualquer coisa sobre ele.
 */
export function encontrarEstacaoMareParaSpot(
  lat: number,
  lng: number
): EstacaoMaregrafica | null {
  const estacao = encontrarEstacaoMaregraficaMaisProxima(lat, lng);
  const km = distanciaKm(lat, lng, estacao.lat, estacao.lng);
  return km <= DISTANCIA_MAX_ESTACAO_KM ? estacao : null;
}

/**
 * Converte e calibra o nível de maré com base na estação do CHM mais próxima.
 *
 * `estacao: null` significa que nenhuma estação cadastrada está perto o
 * bastante — e nesse caso `nivelNauticoM` também é `null`, de propósito.
 */
export function calibrarNivelMareHarmonica(
  rawMsl: number | null | undefined,
  lat: number,
  lng: number
): { nivelNauticoM: number | null; estacao: EstacaoMaregrafica | null } {
  const estacao = encontrarEstacaoMareParaSpot(lat, lng);

  if (estacao === null) {
    return { nivelNauticoM: null, estacao: null };
  }

  if (typeof rawMsl !== 'number' || !Number.isFinite(rawMsl)) {
    return { nivelNauticoM: null, estacao };
  }

  // Nível Náutico = rawMsl * fatorAmplitude + nívelMédio da estação
  const nautico = rawMsl * estacao.fatorAmplitude + estacao.nivelMedioM;
  const nivelFormatado = Math.max(0.1, Number(nautico.toFixed(2)));

  return {
    nivelNauticoM: nivelFormatado,
    estacao,
  };
}
