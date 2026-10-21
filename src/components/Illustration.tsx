export default function Illustration({ small = false }: { small?: boolean }) {
  return <svg className={small ? 'pet-illustration small' : 'pet-illustration'} viewBox="0 0 330 230" fill="none" aria-hidden="true">
    <ellipse cx="170" cy="209" rx="131" ry="9" fill="#d4dfca" />
    <path d="M31 141c-16-24-3-47 17-58-3 23 5 24 13 32-4-35 7-49 26-56 0 29-10 57-17 76" fill="#bacaa5" />
    <path d="M60 119v88" stroke="#7f9a73" strokeWidth="3" /><path d="M46 155h30l-4 49H51z" fill="#dfbca2" />
    <path d="M105 163c-19 9-35 5-38-8" stroke="#b97e51" strokeWidth="14" strokeLinecap="round" />
    <path d="M111 125c-12 6-22 28-19 59l-1 20h25l7-40 4 40h26l-3-71z" fill="#d6a06c" />
    <path d="M102 54c-21-17-35 15-27 39 5 14 19 12 28-1M145 54c22-17 36 15 28 39-5 14-20 12-29-1" fill="#a76e48" />
    <path d="M86 72c0-30 20-42 39-42s40 14 40 44v32c0 26-20 40-40 40s-39-15-39-40z" fill="#ddb17d" />
    <ellipse cx="125" cy="107" rx="28" ry="22" fill="#f4dfbd" /><circle cx="107" cy="86" r="3.7" fill="#34483b"/><circle cx="145" cy="86" r="3.7" fill="#34483b"/><path d="M118 102c0-6 16-6 16 0 0 5-8 9-8 9s-8-4-8-9" fill="#34483b"/><path d="M126 112v7m0 0c-5 6-10 2-11 0m11 0c5 6 10 2 11 0" stroke="#34483b" strokeWidth="2.4" strokeLinecap="round" />
    <path d="M100 137c15 10 34 10 49 0" stroke="#45664d" strokeWidth="8"/><circle cx="125" cy="146" r="6" fill="#e5c371" />
    <path d="M228 184c30 13 57 2 53-21-2-14-15-13-15-4" stroke="#a2afa0" strokeWidth="13" strokeLinecap="round"/>
    <path d="M203 142c-11 12-15 32-14 62h24l7-37 9 37h23c2-34-7-56-17-64" fill="#b1baaa" />
    <path d="m189 87 1-39 29 21 22-22 9 42c12 26-1 59-30 59-32 0-46-32-31-61" fill="#b8c2af" />
    <path d="m195 73 1-15 13 13m23-1 8-14 4 19" fill="#dab7a4"/><ellipse cx="220" cy="119" rx="22" ry="17" fill="#e9e9d8"/><path d="m213 112 7 5 7-5" fill="#8b796c"/><path d="M204 101v3m31-3v3m-15 13v6m0 0c-4 4-8 3-10 0m10 0c4 4 8 3 10 0" stroke="#34483b" strokeWidth="2.6" strokeLinecap="round"/>
    <path d="m198 120-20-3m20 10-19 2m61-9 20-3m-20 10 19 2" stroke="#7d8d77" strokeWidth="1.8" strokeLinecap="round"/>
    <path d="M202 146c13 7 24 7 36 0" stroke="#cf936b" strokeWidth="6"/><circle cx="220" cy="152" r="5" fill="#e6c573" />
    <path d="M150 202h39l-5-20h-29z" fill="#cf936b"/><ellipse cx="169" cy="183" rx="15" ry="4" fill="#a66f4e" />
    <path d="m273 60 4-10m8 17 10-5m-17 18 10 2" stroke="#d3a66d" strokeWidth="3" strokeLinecap="round"/>
    <path d="M57 43c-8-12-23 1 0 16 23-15 8-28 0-16" fill="#c79a7c" />
  </svg>;
}
