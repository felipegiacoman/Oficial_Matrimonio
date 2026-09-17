const SCRIPT_URL = "https://rsvp-api.felipegiacoman.workers.dev";
const CSV_FIESTA_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSS80lahmhX6xknc-Y9y4M8n2vL8iEbf7VMSQqC1U1HlaYhmA0IpEZBgEGvG9wr8t2jBFmbxttEzYjT/pub?output=csv";

let dataMaestra = [], dataConfirmados = [], dataCancelados = [], dataMesas = [];
let listaComensalesGenerales = [], listaCancelables = [], listaPendientes = [], tarjetasDietas = [];
let listaInvitadosFiesta = [], listaDesglosadaMaestra = [], historialMesas = [];
let comensalModalActivo = null, autoSaveTimer = null, hayCambiosMesas = false;

let filtroActualBanqueteria = 'Todas', filtroMesasEstado = 'todas';
let filtroLadoMaestraActual = 'todos', filtroConfirmacionesLadoActual = 'todos', filtroTrayPorAsignarActual = 'todos';

// ======================= HISTORIAL UNDO / CTRL+Z =======================
function guardarEstadoHistorial() {
    historialMesas.push({
        mesas: JSON.parse(JSON.stringify(dataMesas)),
        asignaciones: listaComensalesGenerales.map(c => ({ id_drag: c.id_drag, mesa: c.mesa }))
    });
    if (historialMesas.length > 25) historialMesas.shift();
    const btn = document.getElementById('btn-undo-mesa');
    if (btn) btn.disabled = false;
}

function deshacerCambioMesa() {
    if (historialMesas.length === 0) return;
    const ant = historialMesas.pop();
    dataMesas = ant.mesas;
    ant.asignaciones.forEach(item => {
        const c = listaComensalesGenerales.find(x => x.id_drag === item.id_drag);
        if (c) c.mesa = item.mesa;
    });
    const btn = document.getElementById('btn-undo-mesa');
    if (btn) btn.disabled = (historialMesas.length === 0);
    dibujarPanelMesas(); dibujarPanelBanqueteria(); marcarCambioPendienteMesas();
}

window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        const p = document.getElementById('panel-mesas');
        if (p && p.classList.contains('active')) { e.preventDefault(); deshacerCambioMesa(); }
    }
});

// ======================= AUTO-GUARDADO Y BOTÓN =======================
function marcarCambioPendienteMesas() {
    hayCambiosMesas = true;
    const btn = document.getElementById('btn-guardar-cambios-mesas');
    const txt = document.getElementById('btn-guardar-texto');
    if (btn) btn.className = "btn btn-warning btn-sm fw-bold px-3 py-2 shadow-sm";
    if (txt) txt.innerHTML = `Guardar Cambios <span class="badge bg-danger ms-1">●</span>`;
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => { guardarCambiosEnBBDD(true); }, 2000);
}

function marcarCambiosGuardadosMesas() {
    hayCambiosMesas = false;
    const btn = document.getElementById('btn-guardar-cambios-mesas');
    const txt = document.getElementById('btn-guardar-texto');
    if (btn) btn.className = "btn btn-success btn-sm fw-bold px-3 py-2 shadow-sm";
    if (txt) {
        txt.innerHTML = `<i class="bi bi-check2-circle me-1"></i>¡Guardado!`;
        setTimeout(() => { if (!hayCambiosMesas && txt) txt.innerText = "Guardar Cambios"; }, 2000);
    }
}

async function guardarCambiosEnBBDD(silencioso = false) {
    const btn = document.getElementById('btn-guardar-cambios-mesas');
    const txt = document.getElementById('btn-guardar-texto');
    if (!silencioso && btn) btn.disabled = true;
    if (!silencioso && txt) txt.innerText = "Guardando...";

    reconciliarMesasHuerfanas();
    const payload = {
        tipo: "guardar_todo_mesas",
        mesas: dataMesas.map(m => ({ numero: parseInt(m.numero), capacidad: parseInt(m.capacidad) || 10, alias: m.alias || '' })),
        asignaciones: listaComensalesGenerales.map(c => ({ nombre_principal: c.nombre_principal, es_pareja: c.es_pareja, mesa_numero: c.mesa }))
    };

    try {
        const res = await fetch(SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const resJson = await res.json();
        if (resJson.error) throw new Error(resJson.error);
        marcarCambiosGuardadosMesas();
        if (!silencioso) alert("✅ ¡Todos los cambios han sido guardados con éxito!");
    } catch(err) {
        console.error("Error guardando:", err);
        if (!silencioso) alert("❌ Error al guardar: " + err.message);
        marcarCambioPendienteMesas();
    } finally {
        if (!silencioso && btn) btn.disabled = false;
    }
}

// ======================= UTILIDADES GENERALES =======================
function quitarTildes(s) { return s ? s.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : ""; }
function escapeHTML(s) { return s ? s.replace(/[&<>'"]/g, t => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[t])) : ""; }

function parseCSV(text) {
    let r = [], row = [''], q = false;
    for (let i = 0; i < text.length; i++) {
        let c = text[i], next = text[i+1];
        if (c === '"') { if (q && next === '"') { row[row.length-1] += '"'; i++; } else { q = !q; } }
        else if (c === ',' && !q) row.push('');
        else if ((c === '\r' || c === '\n') && !q) { if (c === '\r' && next === '\n') i++; r.push(row); row = ['']; }
        else row[row.length-1] += c;
    }
    if (row.length > 1 || row[0] !== '') r.push(row);
    return r;
}

// ======================= FIESTA (GOOGLE SHEETS) =======================
async function cargarDatosFiesta() {
    try {
        const res = await fetch(`${SCRIPT_URL}?action=proxy_csv&url=${encodeURIComponent(CSV_FIESTA_URL)}`);
        const text = await res.text();
        const rows = parseCSV(text.trim());
        if (rows.length < 2) return;
        listaInvitadosFiesta = [];
        for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            const nombre = (r[1] || '').trim(), asiste = (r[2] || '').toLowerCase(), pareja = (r[3] || '').toLowerCase(), notas = (r[4] || '').trim();
            if (!nombre || (!asiste.includes('si') && !asiste.includes('sí'))) continue;
            listaInvitadosFiesta.push({ nombre: nombre, es_pareja: false });
            if (pareja === 'si' || pareja === 'sí') {
                let nP = `Pareja de ${nombre}`;
                if (notas && notas.split(/\s+/).length <= 4 && !notas.includes('.') && !notas.includes('!')) nP = `${notas} (Pareja de ${nombre})`;
                listaInvitadosFiesta.push({ nombre: nP, es_pareja: true });
            }
        }
        document.getElementById('val-fiesta').innerText = listaInvitadosFiesta.length;
        document.getElementById('tab-count-fiesta').innerText = listaInvitadosFiesta.length;
        document.getElementById('fiesta-banquet-val').innerText = listaInvitadosFiesta.length;
        dibujarTablaFiesta();
    } catch(e) { console.warn("Fiesta error:", e); }
}

function dibujarTablaFiesta() {
    const term = quitarTildes((document.getElementById('buscador-fiesta')?.value || '').toLowerCase().trim());
    let html = "", idx = 1;
    listaInvitadosFiesta.forEach(f => {
        if (term === "" || quitarTildes(f.nombre.toLowerCase()).includes(term)) {
            html += `<tr ${f.es_pareja ? 'style="background-color: #fdfbf7;"' : ''}>
                <td class="text-muted fw-bold">${idx++}</td>
                <td class="${f.es_pareja ? 'ps-4' : ''}">${f.es_pareja ? '↳ ' : ''}<strong>${escapeHTML(f.nombre)}</strong></td>
                <td><span class="badge ${f.es_pareja ? 'bg-secondary' : 'text-white'}" style="${!f.es_pareja ? 'background:var(--fiesta-color);' : ''}">${f.es_pareja ? 'Pareja' : 'Titular'}</span></td>
            </tr>`;
        }
    });
    document.getElementById('tabla-fiesta').innerHTML = html || `<tr><td colspan="3" class="text-center text-muted py-4">No hay invitados registrados.</td></tr>`;
}

// ======================= RECONCILIACIÓN Y CARGA INICIAL =======================
function reconciliarMesasHuerfanas() {
    if (!dataMesas.some(m => parseInt(m.numero) === 1)) {
        dataMesas.unshift({ numero: 1, capacidad: 10, alias: 'Mesa de los Novios' });
    }
    const numerosComensales = new Set();
    listaComensalesGenerales.forEach(c => {
        if (c.mesa !== null && c.mesa !== undefined && c.mesa !== "") {
            const n = parseInt(c.mesa);
            if (!isNaN(n) && n > 0) numerosComensales.add(n);
        }
    });
    numerosComensales.forEach(n => {
        if (!dataMesas.some(m => parseInt(m.numero) === n)) {
            dataMesas.push({ numero: n, capacidad: 10, alias: '' });
        }
    });
    dataMesas.forEach(m => {
        if (!m.capacidad || isNaN(parseInt(m.capacidad))) m.capacidad = 10;
        if (parseInt(m.numero) === 1 && !m.alias) m.alias = 'Mesa de los Novios';
    });
    dataMesas.sort((a, b) => parseInt(a.numero) - parseInt(b.numero));
}

async function init() {
    const reloj = document.getElementById('reloj-guardado');
    if (reloj) reloj.innerHTML = `<span class="text-muted"><i class="bi bi-arrow-repeat spin me-1"></i>Conectando...</span>`;
    await cargarDatos();
    cargarDatosFiesta();
}

async function cargarDatos() {
    const reloj = document.getElementById('reloj-guardado');
    try {
        const [resM, resConf, resCanc, resMesas] = await Promise.all([
            fetch(`${SCRIPT_URL}?action=lista`).then(r => r.json()),
            fetch(`${SCRIPT_URL}?action=confirmados`).then(r => r.json()),
            fetch(`${SCRIPT_URL}?action=cancelados`).then(r => r.json()),
            fetch(`${SCRIPT_URL}?action=mesas`).then(r => r.json())
        ]);

        if (resM.error || resConf.error || resCanc.error || resMesas.error) {
            const err = resM.error || resConf.error || resCanc.error || resMesas.error;
            if (reloj) reloj.innerHTML = `<span class="text-danger fw-bold"><i class="bi bi-exclamation-triangle-fill me-1"></i>Error: ${escapeHTML(err)}</span>`;
            alert("Error del servidor: " + err);
            return;
        }

        dataMaestra = resM || []; dataConfirmados = resConf || []; dataCancelados = resCanc || []; dataMesas = resMesas || [];

        // Migrar mesa 0 histórica a Mesa 1
        const m0 = dataMesas.find(m => parseInt(m.numero) === 0);
        if (m0) {
            dataConfirmados.forEach(c => { if (parseInt(c.mesa_numero) === 0) c.mesa_numero = 1; if (parseInt(c.mesa_pareja) === 0) c.mesa_pareja = 1; });
            const m1 = dataMesas.find(m => parseInt(m.numero) === 1);
            if (m1) m1.alias = m0.alias || "Mesa de los Novios"; else { m0.numero = 1; m0.alias = m0.alias || "Mesa de los Novios"; }
            dataMesas = dataMesas.filter(m => parseInt(m.numero) !== 0);
        }

        procesarDatosGenerales();
        reconciliarMesasHuerfanas();
        dibujarPanelBanqueteria(); dibujarPanelConfirmaciones(); dibujarPanelMesas(); dibujarTablaListaMaestra();

        if (reloj) reloj.innerHTML = `<span class="text-success"><i class="bi bi-shield-check me-1"></i>Sistema conectado (${dataConfirmados.length} confirmados · ${dataMesas.length} mesas)</span>`;
    } catch(e) {
        console.error(e);
        if (reloj) reloj.innerHTML = `<span class="text-danger"><i class="bi bi-wifi-off me-1"></i>Sin conexión al servidor</span>`;
    }
}

function procesarDatosGenerales() {
    listaComensalesGenerales = []; listaCancelables = []; listaPendientes = []; listaDesglosadaMaestra = [];

    dataMaestra.forEach(m => {
        listaCancelables.push({ nombre_mostrar: m.nombre, nombre_principal: m.nombre, es_pareja: false });
        const conf = dataConfirmados.find(c => c.nombre_invitado === m.nombre);
        const canc = dataCancelados.some(c => quitarTildes(c.nombre.toLowerCase()) === quitarTildes(m.nombre.toLowerCase()));
        let est = conf ? 'Confirmado' : (canc ? 'Cancelado' : 'Pendiente');

        listaDesglosadaMaestra.push({ id_maestra: m.id, nombre: m.nombre, nombre_principal: m.nombre, es_pareja: false, pareja_activa: parseInt(m.pareja) === 1, nino: parseInt(m.nino) === 1, lado: m.lado || 'Novio', estado: est });

        if (parseInt(m.pareja) === 1) {
            const pConf = conf && conf.lleva_pareja === "Sí";
            const nP = (conf && conf.nombre_pareja && conf.nombre_pareja !== '-' && conf.nombre_pareja.toLowerCase() !== 'pendiente') ? conf.nombre_pareja : `Pareja de ${m.nombre}`;
            const pCanc = dataCancelados.some(c => quitarTildes(c.nombre.toLowerCase()) === quitarTildes(nP.toLowerCase()) || quitarTildes(c.nombre.toLowerCase()) === quitarTildes(`Pareja de ${m.nombre}`.toLowerCase()));
            let estP = pConf ? 'Confirmado' : (pCanc ? 'Cancelado' : 'Pendiente');

            listaDesglosadaMaestra.push({ id_maestra: m.id, nombre: nP, nombre_principal: m.nombre, es_pareja: true, pareja_activa: true, nino: false, lado: m.lado || 'Novio', estado: estP });
            if (!pConf && !pCanc) listaPendientes.push({ nombre: nP, tipo: 'Pareja', nombre_principal: m.nombre, es_pareja: true, lado: m.lado || 'Novio', tiene_pareja_maestra: true });
        }

        if (!conf && !canc) listaPendientes.push({ nombre: m.nombre, tipo: 'Titular', nombre_principal: m.nombre, es_pareja: false, lado: m.lado || 'Novio', tiene_pareja_maestra: parseInt(m.pareja) === 1 });
    });

    dataConfirmados.forEach(c => {
        const m = dataMaestra.find(x => x.nombre === c.nombre_invitado);
        const lado = m ? (m.lado || 'Novio') : 'Novio';
        listaComensalesGenerales.push({ id_drag: `prin_${c.nombre_invitado}`, nombre_mostrar: c.nombre_invitado, nombre_principal: c.nombre_invitado, es_pareja: false, mesa: (c.mesa_numero !== null && c.mesa_numero !== "") ? parseInt(c.mesa_numero) : null, dieta: c.dieta || 'Ninguna', esNino: m ? (m.nino === 1) : false, lado: lado, telefono: c.telefono, lleva_pareja: c.lleva_pareja });

        if (c.lleva_pareja === "Sí") {
            const nP = (c.nombre_pareja && c.nombre_pareja !== "-" && c.nombre_pareja.toLowerCase() !== "pendiente") ? c.nombre_pareja : `Pareja de ${c.nombre_invitado}`;
            listaComensalesGenerales.push({ id_drag: `par_${c.nombre_invitado}`, nombre_mostrar: nP, nombre_principal: c.nombre_invitado, es_pareja: true, mesa: (c.mesa_pareja !== null && c.mesa_pareja !== "") ? parseInt(c.mesa_pareja) : null, dieta: c.dieta_pareja || 'Ninguna', esNino: false, lado: lado, telefono: "-" });
            listaCancelables.push({ nombre_mostrar: nP, nombre_principal: c.nombre_invitado, es_pareja: true });
        }
    });
}

// ======================= MESAS (REORDENAMIENTO CON IDENTIDAD) =======================
function obtenerProximoNumeroDisponible() {
    reconciliarMesasHuerfanas();
    const ocupados = dataMesas.map(m => parseInt(m.numero)).filter(n => n >= 2);
    let p = 2; while (ocupados.includes(p)) p++; return p;
}

function ejecutarCambioNumeroMesa(vNum, nNum) {
    vNum = parseInt(vNum); nNum = parseInt(nNum);
    if (isNaN(vNum) || isNaN(nNum) || vNum === nNum || vNum === 1 || nNum === 1) return;

    guardarEstadoHistorial();
    const m1 = dataMesas.find(m => parseInt(m.numero) === 1);
    let norm = dataMesas.filter(m => parseInt(m.numero) >= 2);
    const idxOrig = norm.findIndex(m => parseInt(m.numero) === vNum);
    if (idxOrig === -1) return;

    const [movida] = norm.splice(idxOrig, 1);
    const idxDest = norm.findIndex(m => parseInt(m.numero) === nNum);
    if (idxDest === -1) norm.push(movida); else norm.splice(idxDest, 0, movida);

    const map = {};
    norm.forEach((m, i) => { const nAnt = parseInt(m.numero); const nNue = i + 2; if (nAnt !== nNue) { map[nAnt] = nNue; m.numero = nNue; } });
    listaComensalesGenerales.forEach(c => { if (c.mesa !== null && map[parseInt(c.mesa)]) c.mesa = map[parseInt(c.mesa)]; });

    dataMesas = m1 ? [m1, ...norm] : norm;
    dibujarPanelMesas(); dibujarPanelBanqueteria(); marcarCambioPendienteMesas();
}

function renumerarMesasContiguas() {
    guardarEstadoHistorial();
    reconciliarMesasHuerfanas();
    const m1 = dataMesas.find(m => parseInt(m.numero) === 1);
    let norm = dataMesas.filter(m => parseInt(m.numero) >= 2);
    const map = {};
    norm.forEach((m, i) => { const nAnt = parseInt(m.numero); const nNue = i + 2; if (nAnt !== nNue) { map[nAnt] = nNue; m.numero = nNue; } });
    listaComensalesGenerales.forEach(c => { if (c.mesa !== null && map[parseInt(c.mesa)]) c.mesa = map[parseInt(c.mesa)]; });

    dataMesas = m1 ? [m1, ...norm] : norm;
    dibujarPanelMesas(); dibujarPanelBanqueteria(); marcarCambioPendienteMesas();
    alert(`✅ Mesas renumeradas consecutivamente del 2 al ${dataMesas.length}.`);
}

function eliminarMesa(num) {
    num = parseInt(num);
    if (num === 1) return alert("La Mesa 1 no se puede eliminar.");
    if (!confirm(`¿Eliminar Mesa ${num}? Los comensales volverán a 'Por Asignar' y las siguientes se compactarán.`)) return;

    guardarEstadoHistorial();
    listaComensalesGenerales.forEach(c => { if (parseInt(c.mesa) === num) c.mesa = null; });
    const m1 = dataMesas.find(m => parseInt(m.numero) === 1);
    let norm = dataMesas.filter(m => parseInt(m.numero) >= 2 && parseInt(m.numero) !== num);

    const map = {};
    norm.forEach((m, i) => { const nAnt = parseInt(m.numero); const nNue = i + 2; if (nAnt !== nNue) { map[nAnt] = nNue; m.numero = nNue; } });
    listaComensalesGenerales.forEach(c => { if (c.mesa !== null && map[parseInt(c.mesa)]) c.mesa = map[parseInt(c.mesa)]; });

    dataMesas = m1 ? [m1, ...norm] : norm;
    dibujarPanelMesas(); dibujarPanelBanqueteria(); marcarCambioPendienteMesas();
}

function dibujarPanelMesas() {
    reconciliarMesasHuerfanas();
    const sinAsignar = listaComensalesGenerales.filter(c => c.mesa === null || c.mesa === "");
    let sTot = 0, sOcup = 0;
    dataMesas.forEach(m => {
        sOcup += listaComensalesGenerales.filter(c => c.mesa !== null && parseInt(c.mesa) === parseInt(m.numero)).length;
        sTot += (parseInt(m.capacidad) || 10);
    });

    document.getElementById('kpi-mesas-totales').innerText = dataMesas.length;
    document.getElementById('kpi-sillas-ocupadas').innerText = sOcup;
    document.getElementById('kpi-sillas-totales').innerText = sTot;
    document.getElementById('kpi-pct-ocupacion').innerText = `${sTot > 0 ? Math.round((sOcup / sTot) * 100) : 0}%`;
    document.getElementById('kpi-sin-mesa').innerText = sinAsignar.length;
    document.getElementById('count-sin-asignar').innerText = sinAsignar.length;

    dibujarListaSinAsignar();
    dibujarGridMesas();
    dibujarResumenMesasBanqueteria();
}

function filtrarTrayPorAsignar(lado) {
    filtroTrayPorAsignarActual = lado;
    document.querySelectorAll('[id^="btn-filtro-tray-"]').forEach(b => b.classList.remove('active'));
    document.getElementById(`btn-filtro-tray-${lado === 'todos' ? 'todos' : (lado === 'nino' ? 'nino' : (lado === 'Novio' ? 'novio' : 'novia'))}`).classList.add('active');
    dibujarListaSinAsignar();
}

function dibujarListaSinAsignar() {
    const sinAsignar = listaComensalesGenerales.filter(c => c.mesa === null || c.mesa === "");
    const term = quitarTildes((document.getElementById('buscador-por-asignar')?.value || '').toLowerCase().trim());
    let html = "";
    sinAsignar.forEach(c => {
        const mTerm = term === "" || quitarTildes(c.nombre_mostrar.toLowerCase()).includes(term);
        const mLado = (filtroTrayPorAsignarActual === 'todos') || (filtroTrayPorAsignarActual === 'nino' ? c.esNino : c.lado === filtroTrayPorAsignarActual);
        if (mTerm && mLado) {
            const torp = c.lado === 'Novia' ? 'torpedo-novia' : (c.lado === 'Ambos' ? 'torpedo-ambos' : 'torpedo-novio');
            const emo = c.lado === 'Novia' ? '👰' : (c.lado === 'Ambos' ? '💍' : '🤵');
            html += `<div class="guest-item draggable-guest" draggable="true" ondragstart="dragGuest(event, '${c.id_drag}')">
                <div class="d-flex align-items-center text-truncate me-2">
                    <span class="torpedo-badge ${torp}">${emo}</span>
                    <strong class="text-truncate" style="font-size:0.83rem;">${escapeHTML(c.nombre_mostrar)}</strong>
                </div>
                <button class="btn btn-outline-dark btn-sm py-0 px-2" style="font-size:0.72rem;" onclick="abrirModalAsignarDirecto('${c.id_drag}')">Sentar</button>
            </div>`;
        }
    });
    document.getElementById('lista-sin-asignar').innerHTML = html || `<p class="text-muted small mt-2 text-center">No hay comensales pendientes.</p>`;
}
function filtrarPorAsignar() { dibujarListaSinAsignar(); }

function dibujarGridMesas() {
    let html = "";
    dataMesas.forEach(m => {
        const num = parseInt(m.numero), esNov = (num === 1);
        const ocup = listaComensalesGenerales.filter(c => c.mesa !== null && parseInt(c.mesa) === num);
        const cap = parseInt(m.capacidad) || 10, llena = (ocup.length >= cap);

        if (filtroMesasEstado === 'disponibles' && llena) return;
        if (filtroMesasEstado === 'llenas' && !llena) return;
        if (filtroMesasEstado === 'novios' && !esNov) return;

        let hOcup = "";
        ocupantes.forEach(c => {
            const torp = c.lado === 'Novia' ? 'torpedo-novia' : (c.lado === 'Ambos' ? 'torpedo-ambos' : 'torpedo-novio');
            const emo = c.lado === 'Novia' ? '👰' : (c.lado === 'Ambos' ? '💍' : '🤵');
            hOcup += `<div class="guest-item draggable-guest" draggable="true" ondragstart="dragGuest(event, '${c.id_drag}')">
                <div class="d-flex align-items-center text-truncate me-2">
                    <span class="torpedo-badge ${torp}">${emo}</span>
                    <span class="text-truncate fw-semibold" style="font-size:0.82rem;">${escapeHTML(c.nombre_mostrar)}</span>
                </div>
                <div class="d-flex align-items-center gap-1">
                    <button class="btn btn-sm btn-light border py-0 px-1 text-muted" onclick="abrirModalAsignarDirecto('${c.id_drag}', ${num})"><i class="bi bi-arrow-left-right" style="font-size:0.75rem;"></i></button>
                    <button class="btn btn-sm text-danger p-0 m-0" onclick="intentarAsignar('${c.id_drag}', null, null, null)"><i class="bi bi-x-circle"></i></button>
                </div>
            </div>`;
        });

        html += `<div class="col-12 col-md-6 col-xl-4 mb-3" id="mesa-col-${num}" ${!esNov ? `ondragover="allowDropMesa(event)" ondragleave="leaveDropMesa(event)" ondrop="dropMesa(event, ${num})"` : ''}>
            <div class="mesa-card ${esNov ? 'mesa-novios' : ''}">
                <div class="d-flex justify-content-between align-items-center mb-2" ${!esNov ? `draggable="true" ondragstart="dragMesa(event, ${num})"` : ''}>
                    <div class="d-flex align-items-center gap-2">
                        ${!esNov ? '<i class="bi bi-arrows-move cursor-move text-muted"></i>' : ''}
                        <div>
                            <h6 class="m-0 fw-bold">${esNov ? '👑 Mesa 1 (Los Novios)' : `Mesa ${num}`}</h6>
                            <div class="mesa-alias" onclick="editarAliasMesa(${num})">${escapeHTML(m.alias || (esNov ? 'Mesa de Honor' : 'Clic para nombrar'))}</div>
                        </div>
                        <i class="bi bi-people action-icon ms-1" title="Cambiar Sillas" onclick="cambiarCapacidad(${num}, ${cap})"></i>
                        <i class="bi bi-pencil-square action-icon" title="Renombrar Alias" onclick="editarAliasMesa(${num})"></i>
                        ${!esNov ? `<i class="bi bi-123 action-icon" title="Mover Número" onclick="cambiarNumero(${num})"></i><i class="bi bi-trash action-icon trash-icon" title="Eliminar" onclick="eliminarMesa(${num})"></i>` : ''}
                    </div>
                    <span class="badge ${llena ? 'bg-danger' : 'bg-success'}">${ocup.length} / ${cap}</span>
                </div>
                <div class="drop-zone mb-2" style="max-height: 230px; overflow-y: auto;" ondragover="allowDropGuest(event)" ondragleave="leaveDropGuest(event)" ondrop="dropGuest(event, ${num}, ${cap}, ${ocup.length})">
                    ${hOcup || '<div class="text-muted small mt-2 text-center">Mesa vacía</div>'}
                </div>
                <button class="btn btn-outline-dark btn-sm w-100 py-1" style="font-size:0.75rem;" onclick="abrirModalSentarEnMesa(${num}, ${cap}, ${ocup.length})" ${llena ? 'disabled' : ''}>+ Sentar comensal</button>
            </div>
        </div>`;
    });
    document.getElementById('contenedor-mesas').innerHTML = html || `<div class="col-12 text-center text-muted py-4">No hay mesas.</div>`;
}

// ======================= DRAG & DROP Y SUBIDA AUTOMÁTICA =======================
function dragGuest(ev, id) { ev.stopPropagation(); ev.dataTransfer.setData("drag-type", "guest"); ev.dataTransfer.setData("text/plain", id); }
function allowDropGuest(ev) { ev.preventDefault(); ev.stopPropagation(); const d = ev.target.closest('.drop-zone'); if (d) d.classList.add('dragover'); }
function leaveDropGuest(ev) { const d = ev.target.closest('.drop-zone'); if (d) d.classList.remove('dragover'); }
function dropGuest(ev, mNum, capMax, capAct) {
    ev.preventDefault(); ev.stopPropagation(); detenerAutoScroll();
    const d = ev.target.closest('.drop-zone'); if (d) d.classList.remove('dragover');
    if (ev.dataTransfer.getData("drag-type") !== "guest") return;
    intentarAsignar(ev.dataTransfer.getData("text/plain"), mNum, capMax, capAct);
}

function dragMesa(ev, num) { if (parseInt(num) === 1) { ev.preventDefault(); return; } ev.stopPropagation(); ev.dataTransfer.setData("drag-type", "mesa"); ev.dataTransfer.setData("text/plain", num.toString()); }
function allowDropMesa(ev) { if (ev.dataTransfer.types.includes("drag-type")) { ev.preventDefault(); const c = ev.currentTarget.querySelector('.mesa-card'); if (c && !c.classList.contains('mesa-novios')) c.classList.add('highlight-mesa'); } }
function leaveDropMesa(ev) { const c = ev.currentTarget.querySelector('.mesa-card'); if (c) c.classList.remove('highlight-mesa'); }
function dropMesa(ev, target) {
    ev.preventDefault(); ev.stopPropagation(); detenerAutoScroll();
    const c = ev.currentTarget.querySelector('.mesa-card'); if (c) c.classList.remove('highlight-mesa');
    if (ev.dataTransfer.getData("drag-type") !== "mesa") return;
    const orig = parseInt(ev.dataTransfer.getData("text/plain")), dest = parseInt(target);
    if (orig !== 1 && dest !== 1 && orig !== dest) ejecutarCambioNumeroMesa(orig, dest);
}

function intentarAsignar(idDrag, mesaNum, capMax, capActual) {
    if (!idDrag) return;
    const com = listaComensalesGenerales.find(c => c.id_drag === idDrag);
    if (!com || (mesaNum !== null && com.mesa !== null && parseInt(com.mesa) === parseInt(mesaNum))) return;

    guardarEstadoHistorial();

    if (mesaNum !== null) {
        // Subir pareja automáticamente si cabe
        const par = listaComensalesGenerales.find(c => c.nombre_principal === com.nombre_principal && c.id_drag !== com.id_drag);
        if (par && (par.mesa === null || par.mesa !== mesaNum)) {
            if (capActual + 2 > capMax) { alert(`¡Faltan sillas! Solo quedan ${capMax - capActual} disponibles en la Mesa ${mesaNum}. No caben ambos.`); return; }
            com.mesa = mesaNum; par.mesa = mesaNum;
        } else {
            if (capActual + 1 > capMax) { alert(`¡Mesa completa!`); return; }
            com.mesa = mesaNum;
        }
    } else {
        const par = listaComensalesGenerales.find(c => c.nombre_principal === com.nombre_principal && c.id_drag !== com.id_drag && c.mesa === com.mesa);
        com.mesa = null; if (par) par.mesa = null;
    }

    dibujarPanelMesas(); dibujarPanelBanqueteria(); marcarCambioPendienteMesas();
}

function cambiarNumero(viejo) { if (parseInt(viejo) === 1) return alert("Mesa 1 es fija."); const nue = prompt(`Mover Mesa ${viejo} al número:`); if (nue && !isNaN(nue)) ejecutarCambioNumeroMesa(viejo, nue); }
function crearMesaNormal() { guardarEstadoHistorial(); dataMesas.push({ numero: obtenerProximoNumeroDisponible(), capacidad: parseInt(document.getElementById('nueva-mesa-cap').value) || 10, alias: '' }); dataMesas.sort((a,b)=>parseInt(a.numero)-parseInt(b.numero)); dibujarPanelMesas(); marcarCambioPendienteMesas(); }
function cambiarCapacidad(num, cap) { const n = prompt("Capacidad sillas:", cap); if (n && !isNaN(n) && parseInt(n) > 0) { guardarEstadoHistorial(); const m = dataMesas.find(x => parseInt(x.numero) === parseInt(num)); if (m) m.capacidad = parseInt(n); dibujarPanelMesas(); marcarCambioPendienteMesas(); } }
function editarAliasMesa(num) { const m = dataMesas.find(x => parseInt(x.numero) === parseInt(num)); const n = prompt(`Nombre/Alias Mesa ${num}:`, m ? m.alias : ""); if (n !== null) { guardarEstadoHistorial(); if (m) m.alias = n.trim(); dibujarGridMesas(); dibujarResumenMesasBanqueteria(); marcarCambioPendienteMesas(); } }

function buscarComensalEnMesas(val) {
    const term = quitarTildes(val.toLowerCase().trim());
    document.querySelectorAll('.mesa-card').forEach(c => c.classList.remove('highlight-mesa'));
    if (term.length < 2) return;
    const com = listaComensalesGenerales.find(c => c.mesa !== null && quitarTildes(c.nombre_mostrar.toLowerCase()).includes(term));
    let mObj = com ? parseInt(com.mesa) : null;
    if (!mObj) {
        const m = dataMesas.find(x => (x.alias && quitarTildes(x.alias.toLowerCase()).includes(term)) || `mesa ${x.numero}`.includes(term) || term === x.numero.toString());
        if (m) mObj = parseInt(m.numero);
    }
    if (mObj) {
        const el = document.getElementById(`mesa-col-${mObj}`);
        if (el) { const card = el.querySelector('.mesa-card'); if (card) { card.classList.add('highlight-mesa'); card.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }
    }
}

function filtrarMesasVista(t) {
    filtroMesasEstado = t;
    document.querySelectorAll('[id^="filtro-mesa-"]').forEach(b => b.classList.remove('active'));
    document.getElementById(`filtro-mesa-${t}`).classList.add('active');
    dibujarGridMesas();
}

function abrirModalAsignarDirecto(idDrag, mesaActual = null) {
    const com = listaComensalesGenerales.find(c => c.id_drag === idDrag); if (!com) return;
    comensalModalActivo = com;
    document.getElementById('modalMoverMesaTitulo').innerText = `Asignar a: ${com.nombre_mostrar}`;
    const sel = document.getElementById('select-destino-mesa'); sel.innerHTML = "";
    if (mesaActual !== null) sel.innerHTML += `<option value="desasignar">❌ Quitar de la mesa</option>`;
    dataMesas.forEach(m => {
        const num = parseInt(m.numero), cap = parseInt(m.capacidad) || 10;
        const ocup = listaComensalesGenerales.filter(c => c.mesa !== null && parseInt(c.mesa) === num).length;
        sel.innerHTML += `<option value="${num}" ${ocup >= cap && num !== mesaActual ? 'disabled' : ''} ${num === mesaActual ? 'selected' : ''}>${num === 1 ? '👑 Mesa 1 (Los Novios)' : `Mesa ${num}`} (${ocup}/${cap})</option>`;
    });
    new bootstrap.Modal(document.getElementById('modalMoverMesa')).show();
}

function ejecutarMoverDesdeModal() {
    if (!comensalModalActivo) return;
    const val = document.getElementById('select-destino-mesa').value;
    bootstrap.Modal.getInstance(document.getElementById('modalMoverMesa')).hide();
    if (val === "desasignar") intentarAsignar(comensalModalActivo.id_drag, null, null, null);
    else {
        const num = parseInt(val), m = dataMesas.find(x => parseInt(x.numero) === num), cap = m ? parseInt(m.capacidad) : 10;
        const ocup = listaComensalesGenerales.filter(c => c.mesa !== null && parseInt(c.mesa) === num).length;
        intentarAsignar(comensalModalActivo.id_drag, num, cap, ocup);
    }
}

function abrirModalSentarEnMesa(num, cap, cant) {
    document.getElementById('modalSentarMesaTitulo').innerText = num === 1 ? `Sentar en Mesa 1 (Los Novios)` : `Sentar en Mesa ${num}`;
    const inp = document.getElementById('modal-buscar-sin-asignar'); inp.value = "";
    const sin = listaComensalesGenerales.filter(c => c.mesa === null || c.mesa === "");
    const render = (arr) => {
        document.getElementById('modal-lista-candidatos').innerHTML = arr.map(c => `
            <button class="list-group-item list-group-item-action d-flex justify-content-between align-items-center" onclick="bootstrap.Modal.getInstance(document.getElementById('modalSentarEnMesa')).hide(); intentarAsignar('${c.id_drag}', ${num}, ${cap}, ${cant});">
                <div><strong>${escapeHTML(c.nombre_mostrar)}</strong> <small class="text-muted">${c.es_pareja ? '(Pareja)' : ''}</small></div>
                <span class="btn btn-sm btn-gold py-0 px-2">Sentar</span>
            </button>`).join('') || `<div class="p-3 text-center text-muted small">No hay comensales pendientes.</div>`;
    };
    render(sin);
    inp.oninput = () => render(sin.filter(c => quitarTildes(c.nombre_mostrar.toLowerCase()).includes(quitarTildes(inp.value.toLowerCase().trim()))));
    new bootstrap.Modal(document.getElementById('modalSentarEnMesa')).show();
    setTimeout(() => inp.focus(), 400);
}

// ======================= BANQUETERÍA =======================
function dibujarPanelBanqueteria() {
    let ad = 0, ni = 0, dietas = {};
    listaComensalesGenerales.forEach(c => {
        if (c.esNino) ni++; else ad++;
        if (c.dieta && c.dieta !== "Ninguna" && c.dieta !== "-") dietas[c.dieta] = (dietas[c.dieta] || 0) + 1;
    });
    document.getElementById('adult-val').innerText = ad;
    document.getElementById('nino-val').innerText = ni;
    document.getElementById('fiesta-banquet-val').innerText = listaInvitadosFiesta.length;

    let hDietas = "";
    for (const [d, cant] of Object.entries(dietas)) {
        hDietas += `<div class="col-6 col-md-3 col-lg-2"><div class="stat-card filtrable" onclick="renderTablaBanqueteria('${d}')"><h6 class="small fw-bold text-truncate m-0 mb-2">${d}</h6><div class="stat-val">${cant}</div></div></div>`;
    }
    document.getElementById('contenedor-dietas').innerHTML = hDietas || `<div class="col-12"><p class="text-muted small">No hay dietas especiales registradas.</p></div>`;
    renderTablaBanqueteria(filtroActualBanqueteria);
    dibujarResumenMesasBanqueteria();
}

function dibujarResumenMesasBanqueteria() {
    const cont = document.getElementById('contenedor-mesas-banquetera'); if (!cont) return;
    let html = "";
    dataMesas.forEach(m => {
        const num = parseInt(m.numero), esNov = (num === 1);
        const ocup = listaComensalesGenerales.filter(c => c.mesa !== null && parseInt(c.mesa) === num);
        let esp = [];
        ocup.forEach(o => {
            if (o.esNino) esp.push({ n: o.nombre_mostrar, p: "Menú Infantil" });
            if (o.dieta && o.dieta !== "Ninguna" && o.dieta !== "-") esp.push({ n: o.nombre_mostrar, p: o.dieta });
        });
        html += `<div class="col-12 col-md-6 col-lg-4"><div class="bg-white p-3 rounded shadow-sm border h-100" style="border-top: 4px solid ${esNov ? '#d4af37' : 'var(--oro)'};">
            <div class="d-flex justify-content-between align-items-center mb-2 pb-2 border-bottom"><h6 class="m-0 fw-bold">${esNov ? '👑 Mesa 1 (Los Novios)' : `Mesa ${num}`} ${m.alias ? `- ${escapeHTML(m.alias)}` : ''}</h6><span class="badge bg-dark">${ocup.length} sentados</span></div>
            ${esp.length ? `<div class="p-2 mb-2 rounded bg-warning-subtle small border border-warning"><strong>Especiales (${esp.length}):</strong><ul class="mb-0 ps-3">${esp.map(e => `<li><strong>${escapeHTML(e.n)}:</strong> <span class="text-danger">${escapeHTML(e.p)}</span></li>`).join('')}</ul></div>` : `<div class="small text-success mb-2">✓ Todos comen Menú Estándar</div>`}
            <div class="small text-muted border-top pt-2">${ocup.map(o => `<span class="badge bg-light text-dark border me-1">${escapeHTML(o.nombre_mostrar)}</span>`).join('')}</div>
        </div></div>`;
    });
    cont.innerHTML = html;
}

function renderTablaBanqueteria(filtro = filtroActualBanqueteria) {
    filtroActualBanqueteria = filtro;
    const term = quitarTildes(document.getElementById('buscador-banqueteria').value.toLowerCase().trim());
    let html = "";
    listaComensalesGenerales.forEach(c => {
        const mF = (filtro === 'Todas') || (filtro === 'Niños' && c.esNino) || (c.dieta === filtro);
        const mT = term === "" || quitarTildes(c.nombre_mostrar.toLowerCase()).includes(term);
        if (mF && mT) {
            html += `<tr ${c.es_pareja ? 'style="background-color: #fdfbf7;"' : ''}>
                <td class="${c.es_pareja ? 'ps-4' : ''}">${c.es_pareja ? '↳ ' : ''}<strong>${escapeHTML(c.nombre_mostrar)}</strong></td>
                <td><span class="badge ${c.es_pareja ? 'bg-secondary' : 'bg-primary'}">${c.es_pareja ? 'Pareja' : 'Titular'}</span></td>
                <td>${c.mesa ? (parseInt(c.mesa) === 1 ? `👑 Mesa 1 (Novios)` : `Mesa ${c.mesa}`) : `<span class="text-danger small">Sin mesa</span>`}</td>
                <td><span class="dieta-editable" onclick="editarDietaUI('${c.id_drag}')">${escapeHTML(c.dieta)}</span></td>
                <td><span class="badge ${c.esNino ? 'badge-nino' : 'bg-success'}">${c.esNino ? 'Niño' : 'Adulto'}</span></td>
            </tr>`;
        }
    });
    document.getElementById('lista-tabla-banqueteria').innerHTML = html || `<tr><td colspan="5" class="text-center text-muted">No hay resultados.</td></tr>`;
}

function editarDietaUI(id) {
    const c = listaComensalesGenerales.find(x => x.id_drag === id); if (!c) return;
    const n = prompt(`Nueva restricción para ${c.nombre_mostrar}:`, c.dieta);
    if (n !== null) {
        c.dieta = n.trim() || "Ninguna";
        const conf = dataConfirmados.find(x => x.nombre_invitado === c.nombre_principal);
        if (conf) { if (c.es_pareja) conf.dieta_pareja = c.dieta; else conf.dieta = c.dieta; }
        dibujarPanelBanqueteria(); dibujarPanelConfirmaciones();
        fetch(SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: "editar_dieta", nombre_principal: c.nombre_principal, es_pareja: c.es_pareja, nueva_dieta: c.dieta }) });
    }
}

// ======================= CONFIRMACIONES (FILTRO NOVIO/NOVIA) =======================
function filtrarConfirmacionesLado(lado) {
    filtroConfirmacionesLadoActual = lado;
    document.querySelectorAll('[id^="btn-conf-filtro-"]').forEach(b => b.classList.remove('active'));
    document.getElementById(`btn-conf-filtro-${lado === 'todos' ? 'todos' : (lado === 'Novio' ? 'novio' : (lado === 'Novia' ? 'novia' : 'ambos'))}`).classList.add('active');
    dibujarPanelConfirmaciones();
}

function dibujarPanelConfirmaciones() {
    const term = quitarTildes((document.getElementById('buscador-confirmados')?.value || '').toLowerCase().trim());
    const termP = quitarTildes((document.getElementById('buscador-pendientes')?.value || '').toLowerCase().trim());

    let fConf = listaComensalesGenerales, fPend = listaPendientes, fCanc = dataCancelados;
    if (filtroConfirmacionesLadoActual !== 'todos') {
        fConf = listaComensalesGenerales.filter(c => c.lado === filtroConfirmacionesLadoActual);
        fPend = listaPendientes.filter(p => p.lado === filtroConfirmacionesLadoActual);
        fCanc = dataCancelados.filter(c => { const m = dataMaestra.find(x => x.nombre === c.nombre); return m && m.lado === filtroConfirmacionesLadoActual; });
    }

    document.getElementById('val-confirmados').innerText = fConf.length;
    document.getElementById('val-pendientes').innerText = fPend.length;
    document.getElementById('val-cancelados').innerText = fCanc.length;

    let hConf = "";
    fConf.forEach(c => {
        if (term === "" || quitarTildes(c.nombre_mostrar.toLowerCase()).includes(term)) {
            const btnBajar = `<button class="btn btn-sm btn-outline-danger py-0 px-2 me-1" onclick="bajarDesdeConfirmados('${c.id_drag}')"><i class="bi bi-x-circle"></i> Bajar</button>`;
            const btnMasP = (!c.es_pareja && c.lleva_pareja !== 'Sí') ? `<button class="btn btn-sm btn-outline-primary py-0 px-2" onclick="agregarParejaAConfirmado('${escapeHTML(c.nombre_principal)}')"><i class="bi bi-person-plus"></i> + Pareja</button>` : '';
            hConf += `<tr ${c.es_pareja ? 'style="background-color: #fdfbf7;"' : ''}>
                <td>${btnBajar}${btnMasP}</td>
                <td class="${c.es_pareja ? 'ps-4' : ''}">${c.es_pareja ? '↳ ' : ''}<strong>${escapeHTML(c.nombre_mostrar)}</strong></td>
                <td><span class="badge ${c.es_pareja ? 'bg-secondary' : 'bg-primary'}">${c.es_pareja ? 'Pareja' : 'Titular'}</span></td>
                <td>${escapeHTML(c.telefono || '-')}</td>
                <td>${escapeHTML(c.dieta)}</td>
            </tr>`;
        }
    });
    document.getElementById('tabla-confirmados').innerHTML = hConf || `<tr><td colspan="5" class="text-center text-muted">No hay resultados.</td></tr>`;

    let hPend = "";
    fPend.forEach(p => {
        if (termP === "" || quitarTildes(p.nombre.toLowerCase()).includes(termP)) {
            const btnConf = `<button class="btn btn-sm btn-outline-success py-0 px-2 me-1" onclick="confirmarDesdePendientes('${escapeHTML(p.nombre_principal)}', ${p.es_pareja}, '${escapeHTML(p.nombre)}')"><i class="bi bi-check-lg"></i></button>`;
            const btnBajar = `<button class="btn btn-sm btn-outline-danger py-0 px-2 me-1" onclick="cancelarDesdePendientes('${escapeHTML(p.nombre_principal)}', ${p.es_pareja})"><i class="bi bi-x-circle"></i></button>`;
            hPend += `<tr ${p.tipo === 'Pareja' ? 'style="background-color: #fdfbf7;"' : ''}>
                <td>${btnConf}${btnBajar}</td>
                <td class="${p.tipo === 'Pareja' ? 'ps-4' : ''}">${p.tipo === 'Pareja' ? '↳ ' : ''}<strong>${escapeHTML(p.nombre)}</strong></td>
                <td><span class="badge ${p.tipo === 'Pareja' ? 'bg-secondary' : 'bg-warning text-dark'}">${p.tipo}</span></td>
            </tr>`;
        }
    });
    document.getElementById('tabla-pendientes').innerHTML = hPend || `<tr><td colspan="3" class="text-center text-muted">No hay resultados.</td></tr>`;

    let hCanc = "";
    fCanc.forEach(c => { hCanc += `<tr><td><strong>${escapeHTML(c.nombre)}</strong></td><td><span class="text-muted small">${escapeHTML(c.mensaje || '-')}</span></td></tr>`; });
    document.getElementById('tabla-cancelados').innerHTML = hCanc || `<tr><td colspan="2" class="text-center text-muted">No hay resultados.</td></tr>`;
}

function confirmarDesdePendientes(nombrePrincipal, esPareja, nombreMostrar) {
    let conf = dataConfirmados.find(c => c.nombre_invitado === nombrePrincipal);
    const m = dataMaestra.find(x => x.nombre === nombrePrincipal);

    if (esPareja) {
        if (!confirm(`¿Confirmar a la pareja ${nombreMostrar}?`)) return;
        if (conf) { conf.lleva_pareja = "Sí"; conf.nombre_pareja = nombreMostrar; }
        else dataConfirmados.push({ nombre_invitado: nombrePrincipal, lleva_pareja: "Sí", nombre_pareja: nombreMostrar, telefono: "-", dieta: "Ninguna", dieta_pareja: "Ninguna", mesa_numero: null });
        fetch(SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: "admin_confirmar", nombre_principal: nombrePrincipal, es_pareja: true }) });
    } else {
        if (m && parseInt(m.pareja) === 1) {
            const ambos = confirm(`¿${nombrePrincipal} asistirá CON su pareja?\n\n[Aceptar] = Confirmar a Ambos\n[Cancelar] = Confirmar SOLO al titular`);
            if (ambos) {
                if (!conf) dataConfirmados.push({ nombre_invitado: nombrePrincipal, lleva_pareja: "Sí", nombre_pareja: `Pareja de ${nombrePrincipal}`, telefono: "-", dieta: "Ninguna", dieta_pareja: "Ninguna", mesa_numero: null });
                else { conf.lleva_pareja = "Sí"; if (!conf.nombre_pareja || conf.nombre_pareja === '-') conf.nombre_pareja = `Pareja de ${nombrePrincipal}`; }
                fetch(SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: "admin_confirmar", nombre_principal: nombrePrincipal, es_pareja: true }) });
            } else {
                const pend = confirm(`¿Qué deseas hacer con la pareja?\n\n[Aceptar] = Dejar en PENDIENTES\n[Cancelar] = Marcar como CANCELADA`);
                if (!conf) dataConfirmados.push({ nombre_invitado: nombrePrincipal, lleva_pareja: "No", telefono: "-", dieta: "Ninguna", mesa_numero: null }); else conf.lleva_pareja = "No";
                if (!pend) {
                    dataCancelados.push({ nombre: `Pareja de ${nombrePrincipal}`, mensaje: "No asiste" });
                    fetch(SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: "admin_cancelar", nombre_principal: nombrePrincipal, es_pareja: true }) });
                }
                fetch(SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: "admin_confirmar", nombre_principal: nombrePrincipal, es_pareja: false }) });
            }
        } else {
            if (!confirm(`¿Confirmar a ${nombrePrincipal}?`)) return;
            if (!conf) dataConfirmados.push({ nombre_invitado: nombrePrincipal, lleva_pareja: "No", telefono: "-", dieta: "Ninguna", mesa_numero: null });
            fetch(SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: "admin_confirmar", nombre_principal: nombrePrincipal, es_pareja: false }) });
        }
    }
    procesarDatosGenerales(); dibujarPanelConfirmaciones(); dibujarPanelMesas(); dibujarTablaListaMaestra();
}

function cancelarDesdePendientes(nPrin, esPar) {
    if (!confirm(esPar ? `¿Bajar a la pareja?` : `¿Bajar a ${nPrin}?`)) return;
    dataCancelados.push({ nombre: esPar ? `Pareja de ${nPrin}` : nPrin, mensaje: "Dado de baja" });
    fetch(SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: "admin_cancelar", nombre_principal: nPrin, es_pareja: esPar }) });
    procesarDatosGenerales(); dibujarPanelConfirmaciones(); dibujarTablaListaMaestra();
}

function bajarDesdeConfirmados(id) {
    const c = listaComensalesGenerales.find(x => x.id_drag === id); if (!c) return;
    if (c.es_pareja) {
        if (!confirm(`¿Dar de baja a la pareja ${c.nombre_mostrar}?`)) return;
        const conf = dataConfirmados.find(x => x.nombre_invitado === c.nombre_principal);
        if (conf) { conf.lleva_pareja = 'No'; conf.nombre_pareja = '-'; conf.mesa_pareja = null; }
        dataCancelados.push({ nombre: c.nombre_mostrar, mensaje: 'Cancelada' });
        fetch(SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: "admin_cancelar", nombre_principal: c.nombre_principal, es_pareja: true }) });
    } else {
        if (!confirm(`¿Dar de baja a ${c.nombre_mostrar} y su pareja?`)) return;
        dataConfirmados = dataConfirmados.filter(x => x.nombre_invitado !== c.nombre_principal);
        dataCancelados.push({ nombre: c.nombre_mostrar, mensaje: 'Cancelado' });
        fetch(SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: "admin_cancelar", nombre_principal: c.nombre_principal, es_pareja: false }) });
    }
    procesarDatosGenerales(); dibujarPanelConfirmaciones(); dibujarPanelMesas(); dibujarTablaListaMaestra();
}

function agregarParejaAConfirmado(nPrin) {
    const nom = prompt(`Nombre de la pareja para ${nPrin}:`); if (nom === null) return;
    const nFinal = nom.trim() || `Pareja de ${nPrin}`;
    const conf = dataConfirmados.find(x => x.nombre_invitado === nPrin);
    if (conf) { conf.lleva_pareja = "Sí"; conf.nombre_pareja = nFinal; }
    const m = dataMaestra.find(x => x.nombre === nPrin); if (m) m.pareja = 1;
    fetch(SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: "admin_agregar_pareja_confirmado", nombre_principal: nPrin, nombre_pareja: nFinal, dieta_pareja: "Ninguna" }) });
    procesarDatosGenerales(); dibujarPanelConfirmaciones(); dibujarPanelMesas(); dibujarTablaListaMaestra();
}

// ======================= LISTA MAESTRA =======================
function dibujarTablaListaMaestra() {
    const term = quitarTildes((document.getElementById('buscador-maestra')?.value || '').toLowerCase().trim());
    let tTit = dataMaestra.length, tPar = dataMaestra.filter(m => parseInt(m.pareja) === 1).length;
    let cNov = 0, cNovia = 0, cAmb = 0;
    listaDesglosadaMaestra.forEach(item => { if (item.lado === 'Novia') cNovia++; else if (item.lado === 'Ambos') cAmb++; else cNov++; });

    document.getElementById('maestra-total-titulares').innerText = tTit;
    document.getElementById('maestra-total-parejas').innerText = tPar;
    document.getElementById('maestra-total-sillas').innerText = tTit + tPar;
    document.getElementById('maestra-count-novio').innerText = cNov;
    document.getElementById('maestra-count-novia').innerText = cNovia;
    document.getElementById('maestra-count-ambos').innerText = cAmb;

    let html = "", num = 1;
    listaDesglosadaMaestra.forEach(item => {
        const mL = (filtroLadoMaestraActual === 'todos') || (item.lado === filtroLadoMaestraActual);
        const mT = term === "" || quitarTildes(item.nombre.toLowerCase()).includes(term);
        const cur = num++;
        if (mL && mT) {
            const torp = item.lado === 'Novia' ? 'badge-novia' : (item.lado === 'Ambos' ? 'badge-ambos' : 'badge-novio');
            const emo = item.lado === 'Novia' ? '👰 Novia' : (item.lado === 'Ambos' ? '💍 Ambos' : '🤵 Novio');
            html += `<tr ${item.es_pareja ? 'style="background-color: #fcfaf7;"' : ''}>
                <td class="text-muted fw-bold">${cur}</td>
                <td class="${item.es_pareja ? 'ps-4' : ''}">${item.es_pareja ? '↳ ' : ''}<strong>${escapeHTML(item.nombre)}</strong></td>
                <td><span class="badge ${torp} ${!item.es_pareja ? 'lado-selector' : ''}" ${!item.es_pareja ? `onclick="alternarLadoMaestra(${item.id_maestra})"` : ''}>${emo}</span></td>
                <td><span class="badge ${item.es_pareja ? 'bg-secondary' : 'bg-primary'}">${item.es_pareja ? 'Pareja' : 'Titular'}</span></td>
                <td>${!item.es_pareja ? `<button class="btn btn-sm ${item.pareja_activa ? 'btn-outline-primary' : 'btn-outline-secondary'} py-0 px-2" style="font-size:0.75rem;" onclick="alternarParejaMaestra(${item.id_maestra})">${item.pareja_activa ? 'Con Pareja' : 'Solo'}</button>` : '<span class="badge bg-light text-secondary border">Acompañante</span>'}</td>
                <td><span class="badge ${item.nino ? 'badge-nino' : 'bg-light text-dark border'}">${item.nino ? 'Niño' : 'Adulto'}</span></td>
                <td><span class="badge ${item.estado === 'Confirmado' ? 'bg-success' : (item.estado === 'Cancelado' ? 'bg-danger' : 'bg-warning text-dark')}">${item.estado}</span></td>
                <td>${!item.es_pareja ? `<button class="btn btn-sm btn-outline-danger py-0 px-2" onclick="eliminarInvitadoMaestra(${item.id_maestra}, '${escapeHTML(item.nombre)}')"><i class="bi bi-trash"></i></button>` : ''}</td>
            </tr>`;
        }
    });
    document.getElementById('tabla-lista-maestra').innerHTML = html || `<tr><td colspan="8" class="text-center text-muted py-4">No hay comensales.</td></tr>`;
}

function filtrarLadoMaestra(lado) {
    filtroLadoMaestraActual = lado;
    document.querySelectorAll('[id^="btn-filtro-lado-"]').forEach(b => b.classList.remove('active'));
    document.getElementById(`btn-filtro-lado-${lado === 'todos' ? 'todos' : (lado === 'Novio' ? 'novio' : (lado === 'Novia' ? 'novia' : 'ambos'))}`).classList.add('active');
    dibujarTablaListaMaestra();
}

function alternarLadoMaestra(id) {
    const item = dataMaestra.find(m => parseInt(m.id) === parseInt(id)); if (!item) return;
    const orden = ['Novio', 'Novia', 'Ambos'];
    item.lado = orden[(orden.indexOf(item.lado || 'Novio') + 1) % 3];
    procesarDatosGenerales(); dibujarTablaListaMaestra(); dibujarPanelMesas();
    fetch(SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: "editar_lado_maestra", id: item.id, lado: item.lado }) });
}

function alternarParejaMaestra(id) {
    const item = dataMaestra.find(m => parseInt(m.id) === parseInt(id)); if (!item) return;
    item.pareja = parseInt(item.pareja) === 1 ? 0 : 1;
    if (item.pareja === 0) { const conf = dataConfirmados.find(c => c.nombre_invitado === item.nombre); if (conf) { conf.lleva_pareja = 'No'; conf.nombre_pareja = '-'; conf.mesa_pareja = null; } }
    procesarDatosGenerales(); dibujarTablaListaMaestra(); dibujarPanelConfirmaciones(); dibujarPanelMesas();
    fetch(SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: "editar_pareja_maestra", id: item.id, pareja: item.pareja }) });
}

function abrirModalAgregarInvitado() {
    document.getElementById('modal-nuevo-nombre').value = ""; document.getElementById('modal-nuevo-lado').value = "Novio";
    document.getElementById('modal-nuevo-pareja').checked = false; document.getElementById('modal-nuevo-nino').checked = false;
    new bootstrap.Modal(document.getElementById('modalAgregarInvitado')).show();
}

function guardarInvitadoModalMaestra(e) {
    e.preventDefault();
    const nom = document.getElementById('modal-nuevo-nombre').value.trim();
    if (!nom || dataMaestra.some(m => quitarTildes(m.nombre.toLowerCase()) === quitarTildes(nom.toLowerCase()))) return alert("Ya existe o es inválido.");
    const pId = dataMaestra.reduce((max, o) => Math.max(max, parseInt(o.id) || 0), 0) + 1;
    const nObj = { id: pId, nombre: nom, pareja: document.getElementById('modal-nuevo-pareja').checked ? 1 : 0, nino: document.getElementById('modal-nuevo-nino').checked ? 1 : 0, lado: document.getElementById('modal-nuevo-lado').value };
    dataMaestra.push(nObj);
    bootstrap.Modal.getInstance(document.getElementById('modalAgregarInvitado')).hide();
    procesarDatosGenerales(); dibujarTablaListaMaestra(); dibujarPanelConfirmaciones();
    fetch(SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: "agregar_maestra", ...nObj }) });
}

function eliminarInvitadoMaestra(id, nom) {
    if (!confirm(`¿Eliminar definitivamente a ${nom}?`)) return;
    dataMaestra = dataMaestra.filter(m => parseInt(m.id) !== parseInt(id));
    dataConfirmados = dataConfirmados.filter(c => c.nombre_invitado !== nom);
    listaComensalesGenerales = listaComensalesGenerales.filter(c => c.nombre_principal !== nom);
    procesarDatosGenerales(); dibujarTablaListaMaestra(); dibujarPanelConfirmaciones(); dibujarPanelMesas();
    fetch(SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: "eliminar_maestra", id: id, nombre: nom }) });
}

// ======================= EXCEL EXPORTS =======================
function exportarExcel(datos, hoja, archivo) {
    const ws = XLSX.utils.json_to_sheet(datos), wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, hoja); XLSX.writeFile(wb, archivo);
}
function exportarExcelMesas() {
    exportarExcel(listaComensalesGenerales.map(c => ({ "Mesa": c.mesa ? (parseInt(c.mesa) === 1 ? "Mesa 1 (Novios)" : `Mesa ${c.mesa}`) : "Sin Asignar", "Nombre": c.nombre_mostrar, "Tipo": c.es_pareja ? "Pareja" : "Titular", "Lado": c.lado })), "Plano Mesas", "Mesas_Matrimonio.xlsx");
}
function exportarExcelBanqueteria() {
    exportarExcel(listaComensalesGenerales.map(c => ({ "Nombre": c.nombre_mostrar, "Tipo": c.es_pareja ? "Pareja" : "Titular", "Mesa": c.mesa ? `Mesa ${c.mesa}` : "Sin asignar", "Restricción": c.dieta, "Menú": c.esNino ? "Niño" : "Adulto" })), "Banquetería", "Banqueteria_Matrimonio.xlsx");
}
function exportarExcelConfirmaciones() {
    exportarExcel(listaComensalesGenerales.map(c => ({ "Nombre": c.nombre_mostrar, "Tipo": c.es_pareja ? "Pareja" : "Titular", "Teléfono": c.telefono || "-", "Restricción": c.dieta })), "Confirmados", "Confirmaciones_Matrimonio.xlsx");
}
function exportarExcelListaMaestra() {
    let num = 1;
    exportarExcel(listaDesglosadaMaestra.map(i => ({ "#": num++, "Nombre": i.nombre, "Tipo": i.es_pareja ? "Pareja" : "Titular", "Lado": i.lado, "Menú": i.nino ? "Niño" : "Adulto", "Estado": i.estado })), "Lista Maestra", "Lista_Maestra_Matrimonio.xlsx");
}

if (sessionStorage.getItem('matri_unlocked')) { init(); }