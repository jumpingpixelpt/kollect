const ANCHOR = {
  kol: "Lidera autoridade", rising_star: "Aposta de descoberta", hidden_gem: "Eficiência", brand_performer: "Sustentação",
};
export default function SquadFit({ classe, classeLabel, nicho, firstName }) {
  const role = ANCHOR[classe] || "Specialist Voice";
  const terr = nicho || "beleza";
  return (
    <div className="panel">
      <h3>Squad Fit <span>· arquitetura de casting</span></h3>
      <div className="panel-desc">
        <b>O que é:</b> como essa creator se encaixa num squad — a marca global não compra um nome, compra arquitetura. <b>Por que acompanhar:</b> transforma o perfil individual em montagem de campanha.
      </div>
      <div className="squad-hero">Use <b>{firstName}</b> como <b>{role}</b> num squad de <b>{terr}</b>.</div>
      <div className="squad-comp">
        <div className="squad-cell"><span className="squad-n">1</span><span>KOL authority {classe === "kol" ? "(ela)" : ""}</span></div>
        <div className="squad-cell"><span className="squad-n">2</span><span>Rising Stars</span></div>
        <div className="squad-cell"><span className="squad-n">4</span><span>Hidden Gems</span></div>
        <div className="squad-cell"><span className="squad-n">8</span><span>Brand Safe Performers</span></div>
      </div>
      <div className="formula-note">Composição sugerida: 1 autoridade ancorando + rising stars pra momentum + hidden gems pra eficiência + brand safe pra escala segura.</div>
    </div>
  );
}
