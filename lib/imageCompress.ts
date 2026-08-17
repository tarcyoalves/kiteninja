/**
 * Fotos tiradas direto da câmera do celular costumam vir com 3-8MB. Enviar isso
 * como data URL no corpo de uma requisição JSON é lento na rede da praia e pode
 * bater em limites de tamanho de body do servidor/hospedagem. Por isso a imagem
 * é redesenhada num canvas em resolução menor e reexportada como JPEG com
 * compressão antes de sair do navegador.
 */

/**
 * Teto do corpo da requisição na Vercel é 4,5MB, e base64 infla o binário em
 * ~33%. Passar disso falha no envio, então reduzimos a qualidade em degraus até
 * caber — foto um pouco mais chapada é melhor que relato que não publica.
 */
const MAX_DATA_URL_CHARS = 1_400_000;

export function compressImage(file: File, maxPx = 1280, quality = 0.75): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const { width, height } = img;
      const scale = Math.min(1, maxPx / Math.max(width, height));
      const targetWidth = Math.round(width * scale);
      const targetHeight = Math.round(height * scale);

      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Não foi possível processar a imagem neste navegador.'));
        return;
      }

      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

      /**
       * Exporta e, se o resultado ainda estiver grande demais para o corpo da
       * requisição, tenta de novo com menos qualidade. Foto de textura fina
       * (areia, água picada) comprime mal e é justamente o caso comum aqui.
       */
      const exportar = (q: number, tentativasRestantes: number) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Falha ao comprimir a imagem.'));
              return;
            }
            const reader = new FileReader();
            reader.onload = () => {
              const dataUrl = reader.result as string;
              if (dataUrl.length > MAX_DATA_URL_CHARS && tentativasRestantes > 0) {
                exportar(Math.max(0.4, q - 0.15), tentativasRestantes - 1);
                return;
              }
              if (dataUrl.length > MAX_DATA_URL_CHARS) {
                reject(
                  new Error('A foto ficou grande demais para enviar. Tente outra imagem.')
                );
                return;
              }
              resolve(dataUrl);
            };
            reader.onerror = () => reject(new Error('Falha ao ler a imagem comprimida.'));
            reader.readAsDataURL(blob);
          },
          'image/jpeg',
          q
        );
      };

      exportar(quality, 3);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Não foi possível carregar a imagem selecionada.'));
    };

    img.src = objectUrl;
  });
}
