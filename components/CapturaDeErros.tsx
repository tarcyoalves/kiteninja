'use client';

import { useEffect } from 'react';

/**
 * Manda para o servidor os erros que acontecem no aparelho do velejador.
 *
 * POR QUE ISTO EXISTE
 *
 * O erro de servidor a gente passou a registrar em `handle()`. Mas boa parte
 * do que quebra neste app quebra no cliente e nunca chega ao servidor: a
 * WebView do Android com uma API que o Chrome de desktop tem, o Leaflet que
 * não montou, o `undefined` numa tela que só aparece com dado de um usuário
 * específico. Nada disso deixa rastro — o velejador só vê a tela branca e
 * fecha o app.
 *
 * Dois ganchos cobrem quase tudo: `error` para exceção não capturada e
 * `unhandledrejection` para promessa rejeitada sem `catch` — que é o caso mais
 * comum num app cheio de `fetch`.
 *
 * SILÊNCIO ABSOLUTO É REQUISITO: este componente não renderiza nada e nunca
 * mostra nada ao usuário. Quem está no mar não precisa saber que o log falhou,
 * e um erro dentro do relator de erros não pode virar um laço.
 */
export const CapturaDeErros: React.FC = () => {
  useEffect(() => {
    // Evita reenviar o mesmo erro em laço dentro da mesma sessão de tela. O
    // servidor também deduplica, mas isto economiza o 4G da praia.
    const jaEnviados = new Set<string>();

    const enviar = (mensagem: string, stack?: string) => {
      if (!mensagem) return;
      const chave = `${mensagem}|${window.location.pathname}`;
      if (jaEnviados.has(chave)) return;
      jaEnviados.add(chave);

      // `keepalive` para o envio sobreviver à navegação que às vezes acompanha
      // o erro. Falha de rede aqui é ignorada de propósito.
      void fetch('/api/erros', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensagem, stack, rota: window.location.pathname }),
        keepalive: true,
      }).catch(() => {});
    };

    const aoErro = (e: ErrorEvent) => {
      enviar(e.message || 'Erro sem mensagem', e.error instanceof Error ? e.error.stack : undefined);
    };

    const aoRejeitar = (e: PromiseRejectionEvent) => {
      const motivo = e.reason;
      enviar(
        motivo instanceof Error ? motivo.message : String(motivo ?? 'Promessa rejeitada'),
        motivo instanceof Error ? motivo.stack : undefined
      );
    };

    window.addEventListener('error', aoErro);
    window.addEventListener('unhandledrejection', aoRejeitar);
    return () => {
      window.removeEventListener('error', aoErro);
      window.removeEventListener('unhandledrejection', aoRejeitar);
    };
  }, []);

  return null;
};
