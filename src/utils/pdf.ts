import { jsPDF } from "jspdf";
import autoTable, { type RowInput } from "jspdf-autotable";
import type { Componente, Emprestimo, Unidade } from "../types";
import { resumirEmprestimos, resumirUnidades, selecionarComponentes } from "./componente";
import { statusEstoque } from "./estoque";
import { plural } from "./format";

export interface OpcoesPdf {
  /** tipos escolhidos (principal OU extras, ex: "Básico"). Vazio = todos */
  tipos: string[];
  mostrarEstado: boolean;
  mostrarEmprestimo: boolean;
  mostrarLocalizacao: boolean;
}

/** As fontes padrão do PDF só têm letras latinas/acentos: troca o resto por equivalentes simples. */
export function textoPdf(t: string | null | undefined): string {
  return (t ?? "")
    .replace(/Ω/g, " ohm")
    .replace(/[≤]/g, "<=")
    .replace(/[≥]/g, ">=")
    .replace(/[→]/g, "->")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[•·]/g, "-")
    .replace(/[^\u0000-ÿ]/g, "?");
}

interface Dados {
  componentes: Componente[];
  unidadesPorComponente: Map<number, Unidade[]>;
  emprestimosPorComponente: Map<number, Emprestimo[]>;
}

export function gerarPdfInventario(dados: Dados, opcoes: OpcoesPdf): jsPDF {
  const itens = selecionarComponentes(dados.componentes, opcoes.tipos);

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const larguraPagina = doc.internal.pageSize.getWidth();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(249, 115, 22);
  doc.text("Inventário Solares", 14, 16);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90);
  const totalUnidades = itens.reduce((s, c) => s + c.quantidade, 0);
  doc.text(
    textoPdf(
      `Gerado em ${new Date().toLocaleString("pt-BR")}  |  ${itens.length} componentes  |  ${totalUnidades} unidades` +
        (opcoes.tipos.length ? `  |  Tipos: ${opcoes.tipos.join(", ")}` : "  |  Todos os tipos"),
    ),
    14,
    22,
  );

  // cabeçalho das colunas
  const colunas = ["Componente", "Outros tipos", "Qtd", "Mín."];
  if (opcoes.mostrarEstado) colunas.push("Bom", "Duvid.", "Ruim");
  if (opcoes.mostrarEmprestimo) colunas.push("Emprest.", "Com quem");
  if (opcoes.mostrarLocalizacao) colunas.push("Local");

  // agrupa pelo tipo principal
  const grupos = new Map<string, Componente[]>();
  for (const c of itens) {
    const g = grupos.get(c.tipo);
    if (g) g.push(c);
    else grupos.set(c.tipo, [c]);
  }

  const corpo: RowInput[] = [];
  const nomesGrupos = Array.from(grupos.keys()).sort((a, b) => a.localeCompare(b, "pt-BR"));
  for (const tipo of nomesGrupos) {
    const lista = grupos.get(tipo)!.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }));
    corpo.push([
      {
        content: textoPdf(`${tipo.toUpperCase()}  -  ${plural(lista.length, "item", "itens")}, ${plural(lista.reduce((s, c) => s + c.quantidade, 0), "unidade", "unidades")}`),
        colSpan: colunas.length,
        styles: { fillColor: [255, 237, 213], textColor: [154, 52, 18], fontStyle: "bold" },
      },
    ]);
    for (const c of lista) {
      const resumo = resumirUnidades(c, dados.unidadesPorComponente.get(c.id) ?? []);
      const emp = resumirEmprestimos(c, dados.emprestimosPorComponente.get(c.id) ?? []);
      const falta = statusEstoque(c) !== "ok";
      const linha: RowInput = [
        { content: textoPdf(c.nome), styles: { fontStyle: "bold" } },
        textoPdf((c.outros_tipos ?? []).join(", ")),
        { content: String(c.quantidade), styles: { halign: "right", textColor: falta ? [220, 38, 38] : 0 } },
        { content: String(c.quantidade_minima), styles: { halign: "right" } },
      ];
      if (opcoes.mostrarEstado) {
        linha.push(
          { content: String(resumo.bom), styles: { halign: "right" } },
          { content: resumo.duvidoso ? String(resumo.duvidoso) : "-", styles: { halign: "right", textColor: resumo.duvidoso ? [180, 130, 0] : 150 } },
          { content: resumo.ruim ? String(resumo.ruim) : "-", styles: { halign: "right", textColor: resumo.ruim ? [220, 38, 38] : 150 } },
        );
      }
      if (opcoes.mostrarEmprestimo) {
        linha.push(
          { content: emp.emprestado ? String(emp.emprestado) : "-", styles: { halign: "right" } },
          textoPdf(emp.pessoas.join(", ")),
        );
      }
      if (opcoes.mostrarLocalizacao) linha.push(textoPdf(c.localizacao));
      corpo.push(linha);
    }
  }

  autoTable(doc, {
    startY: 28,
    head: [colunas],
    body: corpo,
    theme: "grid",
    styles: { fontSize: 8.5, cellPadding: 1.8, lineColor: [229, 231, 235], lineWidth: 0.2 },
    headStyles: { fillColor: [31, 41, 55], textColor: 255, fontStyle: "bold" },
    margin: { left: 14, right: 14, bottom: 14 },
    didDrawPage: () => {
      const pagina = doc.getCurrentPageInfo().pageNumber;
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(`Página ${pagina}`, larguraPagina - 14, doc.internal.pageSize.getHeight() - 7, { align: "right" });
    },
  });

  if (itens.length === 0) {
    doc.setFontSize(11);
    doc.setTextColor(120);
    doc.text("Nenhum componente com os tipos escolhidos.", 14, 40);
  }

  return doc;
}
