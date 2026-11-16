'use client';

/**
 * Relatos da comunidade (lista, publicar, curtir, comentar) — terceira fatia
 * da T17, saída de `KiteDataContext.tsx`.
 *
 * ÚNICA DIFERENÇA DE COMPORTAMENTO, e ela é de propósito: depois de publicar,
 * comentar ou de uma curtida que falhou, recarrega-se SÓ a lista de relatos.
 * Antes essas três ações chamavam o carregador geral do contexto, que também
 * refazia eventos e alertas — duas consultas a mais ao banco que nada tinham a
 * ver com o que a pessoa acabou de fazer. No plano gratuito do Neon cada
 * consulta acorda o banco; e é o que deixa este arquivo não depender do
 * carregador geral (que, por sua vez, depende daqui para preencher a lista).
 *
 * `carregarPosts` REJEITA quando a rota falha: quem chama no conjunto
 * (`Promise.allSettled` no contexto) precisa saber que este pedaço falhou para
 * manter a lista anterior. `recarregarPosts` é a versão que engole a falha,
 * usada depois de uma ação — igual ao comportamento anterior.
 */
import { useCallback, useState } from 'react';
import type { CommunityPost } from '../types';

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;

export function useRelatos(api: Api) {
  const [posts, setPosts] = useState<CommunityPost[]>([]);

  const carregarPosts = useCallback(async () => {
    const dados = await api<{ posts: CommunityPost[] }>('/api/posts');
    setPosts(dados.posts);
  }, [api]);

  const recarregarPosts = useCallback(() => carregarPosts().catch(() => {}), [carregarPosts]);
  const addPost = async (
    postData: Omit<CommunityPost, 'id' | 'likes' | 'comments' | 'shares'>
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      await api<{ id: string }>('/api/posts', {
        method: 'POST',
        body: JSON.stringify({
          title: postData.title,
          content: postData.content,
          spotName: postData.spotName,
          spotLocation: postData.spotLocation,
          photoUrl: postData.photoUrl,
          windKnots: postData.windReport?.knots,
          windKiteUsed: postData.windReport?.kiteUsed,
          windCondition: postData.windReport?.condition,
          tag: postData.tag,
        }),
      });
      await recarregarPosts();
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Não foi possível publicar o relato.',
      };
    }
  };

  const toggleLikePost = (postId: string) => {
    // Otimista, igual ao favorito: o toque muda a tela e o servidor confirma.
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id !== postId) return p;
        const isLiked = !p.isLiked;
        return { ...p, isLiked, likes: isLiked ? p.likes + 1 : Math.max(0, p.likes - 1) };
      })
    );

    api<{ isLiked: boolean; count: number }>(`/api/posts/${postId}/like`, { method: 'POST' })
      .then((res) => {
        setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, isLiked: res.isLiked, likes: res.count } : p)));
      })
      .catch(() => recarregarPosts());
  };

  // Devolve o resultado: a tela precisa saber se o comentário entrou para não
  // apagar o que a pessoa escreveu quando o envio falha.
  const addComment = (postId: string, text: string): Promise<{ ok: boolean; error?: string }> => {
    return api<{ id: string }>(`/api/posts/${postId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    })
      .then(() => {
        recarregarPosts();
        return { ok: true as const };
      })
      .catch((err) => ({
        ok: false as const,
        error: err instanceof Error ? err.message : 'Não foi possível comentar.',
      }));
  };

  return { posts, carregarPosts, addPost, toggleLikePost, addComment };
}
