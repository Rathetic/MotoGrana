/* =====================================================
   Movix – configuração da conexão com o Supabase
   Onde encontrar: painel do Supabase > Project Settings > API
     supabaseUrl     -> "Project URL"  (ex.: https://abcdefgh.supabase.co)
     supabaseAnonKey -> chave "anon" (ou "publishable"). Ela PODE ficar aqui:
                        é pública por natureza e protegida pelo RLS.

   ⚠️ NUNCA cole aqui a chave "service_role" (ou "secret").
      Ela dá acesso total ao banco. O app recusa essas chaves.
   Deixe os dois campos vazios para usar o Movix só neste aparelho.
   ===================================================== */
const MOVIX_CONFIG = {
  supabaseUrl: "https://ddszhuueuvgshicplfft.supabase.co",
  supabaseAnonKey: "sb_publishable_WG_h0cNt25Yqv3vqVmjhlg_jS-ngaFk"
};
