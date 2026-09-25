"use client";
import { useEffect, useState } from "react";
import { enriquecendo, ouvirEnriquecimento } from "@/lib/enrich-status";

/**
 * Substitui o `return null` dos painéis da ficha quando ainda não há dado.
 *
 * Um painel que desaparece é indistinguível de um painel partido: a dobra fica um buraco,
 * sem uma linha a dizer se falta correr alguma coisa, se falhou, ou se aquele creator
 * simplesmente não tem aquilo. Este painel diz sempre qual das três é.
 *
 * Todas as caixas por gerar mostram spinner. O que muda é o ritmo: a girar depressa e cheio
 * quando há mesmo uma cadeia a correr (lib/enrich-status.js), devagar e esbatido quando está
 * só em espera. A distinção fica — um spinner à velocidade normal com nada a processar
 * promete um resultado que não vem a caminho — mas deixa de haver a caixa parada que se lia
 * como painel partido.
 *
 * A única que não gira é `semFonte`: aí a fonte já respondeu e não tinha o dado. Não há nada
 * pendente, e girar contradiria o texto ao lado.
 *
 * Todos os painéis que usam isto são passos da cadeia, incluindo a Audiência desde que a
 * análise passou a ser automática — por isso a instrução "corre ↻ Atualizar dados" vale para
 * todos, sem excepção a tratar.
 */
export default function PainelPendente({ titulo, sub, passo, nota, semFonte = false }) {
  const [correndo, setCorrendo] = useState(false);

  useEffect(() => {
    setCorrendo(enriquecendo());
    return ouvirEnriquecimento(setCorrendo);
  }, []);

  // `semFonte`: o passo correu, a fonte é que não tem o dado. Nunca gira nem manda correr
  // outra vez — mandar repetir o que já foi feito é pior do que não dizer nada. `nota` passa
  // a ser o corpo inteiro, porque o motivo é específico do painel que a passou.
  const ativo = !semFonte && correndo;

  return (
    <div className="panel pendente-panel">
      <h3>{titulo}{sub ? <span> · {sub}</span> : null}</h3>
      <div className="pendente-corpo">
        {semFonte
          ? <span className="pendente-dot" aria-hidden="true" />
          : <span className={`pendente-spin${ativo ? "" : " em-espera"}`} aria-hidden="true" />}
        <div>
          <div className="pendente-t">{semFonte ? "Sem dados na fonte" : ativo ? "A processar…" : "Ainda não gerado"}</div>
          <div className="pendente-d">
            {semFonte ? nota : (
              <>
                {ativo
                  ? `O enriquecimento está a correr. ${passo ? `Este painel vem do passo ${passo}.` : ""} Fica pronto quando a cadeia terminar — a página atualiza sozinha.`
                  : `${passo ? `Vem do passo ${passo} do enriquecimento. ` : ""}Corre ↻ Atualizar dados no topo da ficha.`}
                {nota ? <><br />{nota}</> : null}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
