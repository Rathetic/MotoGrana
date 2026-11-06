/* =====================================================
   Movix – configuração da conexão com o Supabase
   Onde encontrar: painel do Supabase > Project Settings > API
     supabaseUrl     -> "Project URL"  (ex.: https://abcdefgh.supabase.co)
     supabaseAnonKey -> chave "anon" (ou "publishable"). Ela PODE ficar aqui:
                        é pública por natureza e protegida pelo RLS.

   ⚠️ NUNCA cole aqui a chave "service_role" (ou "secret").
      Ela dá acesso total ao banco. O app recusa essas chaves.
   Deixe os dois campos vazios para usar o Movix só neste aparelho.

   Calculadora de frete por km (OpenRouteService, plano gratuito):
     orsApiKey  -> chave gratuita: crie uma conta em https://account.heigit.org, gere
                   um token (API key) no painel e cole aqui entre as aspas.
                   Fica visível no navegador, como a chave "anon" do Supabase:
                   use só a chave gratuita do ORS, nunca uma chave paga.
                   Vazia = a calculadora funciona só com distância manual.
     orsBaseUrl -> (opcional) endereço da API de rotas. Já vem pronto.
     orsGeocodeUrl -> (opcional) endereço da busca de endereços. Já vem pronto.
                   Só mude estes dois se o ORS mudar os endereços.
   ===================================================== */
const MOVIX_CONFIG = {
  supabaseUrl: "https://ddszhuueuvgshicplfft.supabase.co",
  supabaseAnonKey: "sb_publishable_WG_h0cNt25Yqv3vqVmjhlg_jS-ngaFk",
  orsApiKey: "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjE1Y2E2NDc5MjQzMzQ1ZjdiYWY3MzFjYTM0ZWM1MTlmIiwiaCI6Im11cm11cjY0In0=",
  orsBaseUrl: "https://api.heigit.org/openrouteservice",
  orsGeocodeUrl: "https://api.heigit.org/pelias/v1"
};
