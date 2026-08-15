# ERRANTE: O Dorso do Mundo

Vertical slice 3D single-player de sobrevivência para navegador. A partida dura aproximadamente 15–20 minutos e conecta exploração, coleta, crafting, construção, combate, clima, simbiose, vitória, derrota e persistência local em um dorso procedural de 280 unidades de comprimento.

## Executar

Requer Node.js 22.13 ou superior.

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`. O jogo foi projetado para desktop com teclado e mouse.

Validação completa:

```bash
npm run typecheck
npm run lint
npm test
```

Build de produção:

```bash
npm run build
npm run start
```

## Controles

| Ação | Controle |
| --- | --- |
| Movimento | `WASD` |
| Olhar | Mouse |
| Correr | `Shift` |
| Saltar | `Espaço` |
| Esquivar | `Q` |
| Interagir / coletar | `E` |
| Ataque leve | Clique esquerdo |
| Ataque carregado | Segurar clique esquerdo |
| Bloqueio / parry | Clique direito; o parry acontece nos primeiros 280 ms |
| Arremessar lança | `R` |
| Gancho em pontos ósseos | `G` |
| Trocar arma | `1`, `2`, `3` |
| Inventário | `Tab` ou `I` |
| Crafting | `C` |
| Construção | `B` |
| Girar construção | `R` durante o posicionamento |
| Snap de construção | Segurar `Ctrl` durante o posicionamento |
| Desmontar estrutura próxima | `X` |
| Pausa | `Esc` |
| Overlay de performance | `F3` |

Use `?debug=1` na URL para habilitar atalhos de QA: `P` avança o evento, `V` posiciona o jogador na condição de conclusão, `K` força a condição de derrota, `O` leva à borda para inspecionar o oceano, `J` percorre os marcos e todas as placas escuras na auditoria do piso, e `F` vira o personagem para a câmera. O overlay `F3` mostra posição, estado apoiado/no ar e o erro vertical em relação à malha.

## Fluxo da vertical slice

- Despertar e revelação do colosso sem remover o controle do jogador.
- Travessia longa por bosque dorsal, pântano de musgo, Ferida Antiga, cavidade respiratória, ruína presa ao casco e cristas ósseas, conectados por uma trilha sinuosa.
- Personagem low-poly articulado no quadril, ombros, cotovelos, joelhos e tornozelos, com painéis independentes de casaco, faces de dobra, cachecol, cabelo, mochila e animações corporais distintas de repouso, caminhada, corrida, salto e ataque.
- Oceano low-poly animado por shader, com ondas cruzadas facetadas, cristas refletivas, cinco faixas descontínuas de arrebentação ao redor do dorso, spray, bruma e ambiência sonora própria.
- Coleta contextual e receitas data-driven para lança, machado, arco, flechas, corda, curativos, alimento e kit de reparo.
- Construção com preview, validação, rotação, snap, peso dorsal, desmontagem e persistência.
- Vida, stamina, fome, sede, exposição e infecção, com relações entre clima, abrigo, fogo, descanso e alimentação.
- Parasita escavador, carrapato dorsal, predador alado e Parasita Alfa, com percepção, investigação, perseguição, ataque, recuo, atordoamento e retorno.
- Combate com armas distintas, ataques carregados/aéreos, arremesso, bloqueio, parry, armadilhas, balista, hit-stop, reação e partículas.
- Escolha funcional na Ferida Antiga: curar o colosso ou extrair recursos neurais.
- Chuva migratória, mergulho parcial, infestação defensiva e encontro final com outro colosso.
- Dois desfechos baseados na saúde e confiança do colosso, além de derrota por sobrevivência ou combate.
- Autosave versionado a cada 30 segundos, save manual, Continue e recuperação segura de dados inválidos.

## Arquitetura

- `app/game/data.ts`: itens, receitas e estruturas centralizados.
- `app/game/state.ts`: regras puras e tipadas de inventário, crafting, construção, sobrevivência, simbiose e cronologia.
- `app/game/save.ts`: validação defensiva, versionamento e preferências locais.
- `app/game/world.ts`: geração procedural orgânica, material texturizado, atmosfera, oceano, modelos, instancing e recursos visuais.
- `app/game/ai.ts`: definições e estado de execução da IA, atributos por arquétipo e feedback material.
- `app/game/combat.ts`: perfis das armas e regras puras de dano, alcance, carga e ataque aéreo.
- `app/game/events.ts`: apresentação, clima e curvas visuais da cronologia de eventos.
- `app/game/engine.ts`: orquestração do loop fixo de 60 Hz, input, câmera, combate, construção e renderização Three.js.
- `app/game/audio.ts`: paisagem sonora, clima, passos, água, impactos e música adaptativa em camadas sintetizadas com Web Audio.
- `app/game/GameApp.tsx`: shell React acessível, HUD, menus, configurações e fluxo de telas.

A simulação usa timestep fixo e não depende da taxa de renderização. O estado serializável é separado dos objetos Three.js; assim, save/load e testes exercitam as regras sem depender do renderer.

## Performance

- Vegetação e rochas instanciadas.
- Árvores retorcidas montadas com troncos, galhos e copas instanciadas; cobertura rasteira distribuída por bioma.
- Pool fixo de partículas.
- Atualização de IA por estados e número limitado de agentes.
- Presets Baixo, Médio e Alto ajustam pixel ratio, sombras, densidade de vegetação e chuva na criação da partida.
- Frustum culling nativo do Three.js e geometrias compartilhadas para props repetidos.
- Overlay `F3` mostra FPS, frame time, draw calls, triângulos, entidades, contato do piso, posição, seed e evento.

## Limitações conhecidas

- O jogo é otimizado para teclado e mouse; gamepad e controles touch não fazem parte desta slice.
- O contato do jogador usa raycast contra as malhas caminháveis reais e ajuste independente dos pés; superfícies verticais não participam do piso. Obstáculos, construções e câmera usam volumes de bloqueio estáveis. Não há simulação rígida completa de props móveis.
- A câmera evita terreno, vegetação, ossos, ruínas e construções, mas a cavidade é uma experiência curta, não um dungeon interno completo.
- Áudio e música são sintetizados em camadas para manter o projeto autocontido; não dependem de bancos de som externos.
- A arte de gameplay segue direção low-poly consistente: faces visíveis, materiais ásperos, silhuetas facetadas, vegetação instanciada, céu e oceano por shader. A textura orgânica autoral fornece microvariação ao dorso sem substituir sua geometria facetada. O cartão social em `public/og.png` é uma ilustração conceitual, não uma captura do jogo.
- A configuração de qualidade altera o renderer imediatamente; a densidade de cenário correspondente é aplicada ao iniciar ou carregar uma nova partida.

## Licenças e créditos

Consulte [CREDITS.md](./CREDITS.md). Nenhum asset externo de licença incerta é usado.
