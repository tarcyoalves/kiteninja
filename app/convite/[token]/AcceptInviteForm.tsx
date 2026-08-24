'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Compass, LifeBuoy, Scale, ShieldCheck, UserPlus } from 'lucide-react';
import type { Discipline, RiderLevel } from '@/types';

const LEVELS: RiderLevel[] = ['Iniciante', 'Intermediário', 'Avançado', 'Profissional'];
const DISCIPLINES: Discipline[] = ['Kitesurf Twintip', 'Hydrofoil', 'Wingfoil', 'Big Air'];

export function AcceptInviteForm({
  token,
  lockedEmail,
}: {
  token: string;
  lockedEmail: string | null;
}) {
  const router = useRouter();

  const [name, setName] = useState('');
  const [email, setEmail] = useState(lockedEmail ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [weightKg, setWeightKg] = useState(78);
  const [riderLevel, setRiderLevel] = useState<RiderLevel>('Intermediário');
  const [homeSpot, setHomeSpot] = useState('');
  const [disciplines, setDisciplines] = useState<Discipline[]>(['Kitesurf Twintip']);
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const toggleDiscipline = (d: Discipline) => {
    setDisciplines((prev) =>
      prev.includes(d) ? (prev.length > 1 ? prev.filter((x) => x !== d) : prev) : [...prev, d]
    );
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError('As senhas não conferem.');
      return;
    }
    if (password.length < 10) {
      setError('A senha precisa ter no mínimo 10 caracteres.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/invites/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          name,
          email,
          password,
          weightKg,
          riderLevel,
          homeSpot,
          disciplines,
          emergencyContactName: emergencyName.trim(),
          emergencyContactPhone: emergencyPhone.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível criar a conta.');
        return;
      }

      router.push('/');
      router.refresh();
    } catch {
      setError('Falha de conexão. Verifique a internet e tente de novo.');
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    'w-full p-3 rounded-xl bg-[#1E293B] border border-slate-700 text-white font-semibold ' +
    'text-base focus:outline-none focus:border-cyan-400';

  return (
    <main className="min-h-screen bg-[#0F172A] text-slate-100 p-4 pb-10">
      <div className="w-full max-w-md mx-auto">
        <header className="text-center py-6 space-y-2">
          <Compass size={40} className="text-cyan-400 mx-auto" aria-hidden="true" />
          <h1 className="text-2xl font-black">Bem-vindo ao KiteNinja</h1>
          <p className="text-sm text-slate-400">
            Você recebeu um convite para criar sua conta de velejador.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="name" className="block text-xs font-bold text-slate-300 mb-1.5">
              Nome completo
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              autoComplete="name"
              required
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-xs font-bold text-slate-300 mb-1.5">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`${inputClass} ${lockedEmail ? 'opacity-70' : ''}`}
              autoComplete="email"
              readOnly={Boolean(lockedEmail)}
              required
            />
            {lockedEmail && (
              <p className="text-[11px] text-slate-500 mt-1">
                Este convite foi emitido para este endereço.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="password" className="block text-xs font-bold text-slate-300 mb-1.5">
              Senha
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              autoComplete="new-password"
              minLength={10}
              required
            />
            <p className="text-[11px] text-slate-500 mt-1">Mínimo de 10 caracteres.</p>
          </div>

          <div>
            <label htmlFor="confirm" className="block text-xs font-bold text-slate-300 mb-1.5">
              Confirme a senha
            </label>
            <input
              id="confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputClass}
              autoComplete="new-password"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="weight"
                className="block text-xs font-bold text-slate-300 mb-1.5 flex items-center gap-1"
              >
                <Scale size={12} className="text-cyan-400" aria-hidden="true" />
                Peso (kg)
              </label>
              <input
                id="weight"
                type="number"
                min={30}
                max={200}
                value={weightKg}
                onChange={(e) => setWeightKg(Number(e.target.value))}
                className={`${inputClass} text-cyan-400 font-black`}
                required
              />
              <p className="text-[11px] text-slate-500 mt-1">Para o cálculo de pipa.</p>
            </div>

            <div>
              <label htmlFor="level" className="block text-xs font-bold text-slate-300 mb-1.5">
                Nível
              </label>
              <select
                id="level"
                value={riderLevel}
                onChange={(e) => setRiderLevel(e.target.value as RiderLevel)}
                className={inputClass}
              >
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="homeSpot" className="block text-xs font-bold text-slate-300 mb-1.5">
              Home spot
            </label>
            <input
              id="homeSpot"
              type="text"
              value={homeSpot}
              onChange={(e) => setHomeSpot(e.target.value)}
              placeholder="Ex: Ponta do Mel, Cumbuco, Galinhos"
              className={inputClass}
            />
          </div>

          <fieldset>
            <legend className="text-xs font-bold text-slate-300 mb-1.5">
              Modalidades praticadas
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {DISCIPLINES.map((d) => {
                const active = disciplines.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDiscipline(d)}
                    aria-pressed={active}
                    className={`p-3 rounded-xl text-xs font-bold border transition-colors ${
                      active
                        ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                        : 'bg-[#1E293B] border-slate-700 text-slate-400'
                    }`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/*
            Contato de emergência no cadastro, não escondido nas configurações:
            quem entra num app não volta para preencher campo de segurança, e o
            SOS pode ser acionado já na primeira sessão. Sem este contato, o
            painel do acidentado não tem para quem mandar a posição.

            Opcional de propósito — travar a criação da conta aqui empurraria o
            velejador a digitar um número qualquer para passar da tela, e número
            falso é pior que campo vazio: parece cobertura e não é.
          */}
          <fieldset className="p-3 rounded-2xl bg-rose-500/5 border border-rose-500/25 space-y-3">
            <legend className="px-1.5 text-xs font-black text-rose-300 flex items-center gap-1.5">
              <LifeBuoy size={13} aria-hidden="true" />
              Contato de emergência
            </legend>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              Quem avisamos se você acionar o SOS na água. Você pode deixar em
              branco agora e preencher depois no menu, em Segurança.
            </p>

            <div>
              <label htmlFor="emergencyName" className="block text-xs font-bold text-slate-300 mb-1.5">
                Nome do contato
              </label>
              <input
                id="emergencyName"
                type="text"
                value={emergencyName}
                onChange={(e) => setEmergencyName(e.target.value)}
                placeholder="Ex: Maria (esposa)"
                className={inputClass}
                autoComplete="off"
                maxLength={120}
              />
            </div>

            <div>
              <label htmlFor="emergencyPhone" className="block text-xs font-bold text-slate-300 mb-1.5">
                Telefone com DDD
              </label>
              {/*
                type="tel" abre o teclado numérico no celular — no cadastro
                feito na praia, isso é a diferença entre digitar e desistir.
              */}
              <input
                id="emergencyPhone"
                type="tel"
                inputMode="tel"
                value={emergencyPhone}
                onChange={(e) => setEmergencyPhone(e.target.value)}
                placeholder="(84) 99999-0000"
                className={inputClass}
                autoComplete="tel"
                maxLength={30}
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Usado para abrir o WhatsApp com sua posição durante um SOS.
              </p>
            </div>
          </fieldset>

          {error && (
            <p role="alert" className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-sm font-semibold">
              {error}
            </p>
          )}

          <p className="flex items-start gap-2 text-[11px] text-slate-400 leading-relaxed">
            <ShieldCheck size={16} className="text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
            Sua senha é armazenada com hash bcrypt. Este convite vale para uma única
            conta e é invalidado depois do uso.
          </p>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-cyan-500 via-teal-500 to-emerald-500 text-slate-950 font-black text-base flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <UserPlus size={18} aria-hidden="true" />
            {loading ? 'Criando conta...' : 'Criar minha conta'}
          </button>
        </form>
      </div>
    </main>
  );
}
