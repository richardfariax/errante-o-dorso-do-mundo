import type { Metadata } from "next";
import { GameApp } from "./game/GameApp";

export const metadata: Metadata = {
  title: "ERRANTE: O Dorso do Mundo",
  description: "Uma vertical slice 3D de sobrevivência sobre um colosso migratório.",
};

export default function Home() {
  return <GameApp />;
}
