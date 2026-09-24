// Servidor y Link en duro del Google Sheets de la Fiesta
const WORKER_URL_DEFAULT = "https://rsvp-api.felipegiacoman.workers.dev";
let SCRIPT_URL = WORKER_URL_DEFAULT;
const GOOGLE_SHEET_FIESTA_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSS80lahmhX6xknc-Y9y4M8n2vL8iEbf7VMSQqC1U1HlaYhmA0IpEZBgEGvG9wr8t2jBFmbxttEzYjT/pub?output=csv";
let CSV_FIESTA_URL = GOOGLE_SHEET_FIESTA_CSV;

let dataMaestra = []; 
let dataConfirmados = []; 
let dataCancelados = []; 
let dataMesas = [];
let listaComensalesGenerales = []; 
let listaCancelables = []; 
let listaPendientes = []; 
let tarjetasDietas = [];
let listaInvitadosFiesta = [];
let listaDesglosadaMaestra = [];
let comensalModalActivo = null;
let mesaPlanoActiva = null;

// Filtros de navegación
let filtroActualBanqueteria = 'Todas';
let filtroMesasEstado = 'todas';
let filtroLadoMaestraActual = 'todos';
let filtroSinAsignarLado = 'todos';
let filtroConfirmacionesLadoActual = 'todos';

// Control de cambios y sincronización
let hayCambiosMesas = false;

// Helper seguro para asignar texto sin riesgo de caída
function setText(id, valor) {
    const el = document.getElementById(id);
    if (el) el.innerText = valor;
}

// ======================= HISTORIAL PARA DESHACER (CTRL + Z) =======================
let historialUndo = [];

function guardarSnapshotUndo() {
    if (historialUndo.length >= 30) historialUndo.shift();
    historialUndo.push({
        dataMesas: JSON.parse(JSON.stringify(dataMesas)),
        listaComensales: JSON.parse(JSON.stringify(listaComensalesGenerales))
    });
    actualizarBotonUndo();
}

function actualizarBotonUndo() {
    const btn = document.getElementById('btn-undo-mesas');
    const badge = document.getElementById('undo-badge');
    if (btn) {
        btn.disabled = false;
        if (badge) {
            badge.style.display = historialUndo.length > 0 ? 'inline-block' : 'none';
            badge.innerText = historialUndo.length;
        }
    }
}

function deshacerUltimoCambio() {
    if (historialUndo.length === 0) {
        alert("No hay cambios recientes para deshacer.");
        return;
    }
    const snap = historialUndo.pop();
    dataMesas = snap.dataMesas;
    listaComensalesGenerales = snap.listaComensales;
    dibujarPanelMesas();
    dibujarPanelBanqueteria();
    marcarCambioPendienteMesas();
    actualizarBotonUndo();
}

// Atajo de teclado global Ctrl+Z / Cmd+Z
window.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
        e.preventDefault();
        deshacerUltimoCambio();
    }
});

function marcarCambioPendienteMesas() {
    hayCambiosMesas = true;
    const btn = document.getElementById('btn-guardar-cambios-mesas');
    const btnTexto = document.getElementById('btn-guardar-texto');
    if (btn) btn.className = "btn btn-warning btn-sm fw-bold px-3 py-2 shadow-sm";
    if (btnTexto) btnTexto.innerHTML = `Guardar Cambios <span class="badge bg-danger ms-1">●</span>`;
}

function marcarCambiosGuardadosMesas() {
    hayCambiosMesas = false;
    const btn = document.getElementById('btn-guardar-cambios-mesas');
    const btnTexto = document.getElementById('btn-guardar-texto');
    if (btn) btn.className = "btn btn-success btn-sm fw-bold px-3 py-2 shadow-sm";
    if (btnTexto) {
        btnTexto.innerHTML = `<i class="bi bi-check2-circle me-1"></i>¡Guardado!`;
        setTimeout(() => {
            if (!hayCambiosMesas && btnTexto) btnTexto.innerText = "Guardar Cambios";
        }, 2200);
    }
}

// AUTO-GUARDADO CADA 30 SEGUNDOS
setInterval(() => {
    if (hayCambiosMesas) {
        ejecutarGuardadoSilencioso();
    }
}, 30000);

window.addEventListener('beforeunload', (e) => {
    if (hayCambiosMesas) {
        e.preventDefault();
        e.returnValue = 'Tienes cambios en las mesas sin guardar. ¿Deseas salir?';
    }
});

// ======================= AUTO-SCROLL EN ARRASTRE =======================
let autoScrollTimer = null;
let autoScrollSpeed = 0;

function manejarAutoScroll(ev) {
    const umbral = 120;
    const altura = window.innerHeight;
    const y = ev.clientY;

    if (y < umbral) {
        autoScrollSpeed = -Math.max(10, Math.round((umbral - y) / 3));
    } else if (y > altura - umbral) {
        autoScrollSpeed = Math.max(10, Math.round((y - (altura - umbral)) / 3));
    } else {
        autoScrollSpeed = 0;
    }

    if (autoScrollSpeed !== 0 && !autoScrollTimer) {
        autoScrollTimer = setInterval(() => {
            window.scrollBy(0, autoScrollSpeed);
        }, 16);
    } else if (autoScrollSpeed === 0 && autoScrollTimer) {
        detenerAutoScroll();
    }
}

function detenerAutoScroll() {
    if (autoScrollTimer) {
        clearInterval(autoScrollTimer);
        autoScrollTimer = null;
    }
    autoScrollSpeed = 0;
}

window.addEventListener('dragover', manejarAutoScroll);
window.addEventListener('dragend', detenerAutoScroll);
window.addEventListener('drop', detenerAutoScroll);

// FOCO AUTOMÁTICO EN EL BUSCADOR DE "+ SENTAR COMENSAL"
document.addEventListener('DOMContentLoaded', () => {
    const modalSentar = document.getElementById('modalSentarEnMesa');
    if (modalSentar) {
        modalSentar.addEventListener('shown.bs.modal', function () {
            const input = document.getElementById('modal-buscar-sin-asignar');
            if (input) { 
                input.value = ''; 
                input.focus(); 
                input.select(); 
            }
        });
    }
});

// ======================= COLA DE ACCIONES =======================
let syncQueue = JSON.parse(localStorage.getItem('matriSyncQueue') || '[]');
let isSyncing = false;

function saveQueue() { localStorage.setItem('matriSyncQueue', JSON.stringify(syncQueue)); }
function addToQueue(action) { syncQueue.push(action); saveQueue(); processQueue(); }

async function processQueue() {
    if (isSyncing || syncQueue.length === 0) return;
    isSyncing = true;
    while (syncQueue.length > 0) {
        const action = syncQueue[0];
        try {
            await fetch(SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(action)
            });
            syncQueue.shift(); 
            saveQueue();
        } catch (error) {
            console.warn("Reintentando acción...", error);
            isSyncing = false;
            setTimeout(processQueue, 3000); 
            return;
        }
    }
    isSyncing = false;
}

function quitarTildes(str) { 
    if (!str || typeof str !== "string") return "";
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim(); 
}

function escapeHTML(str) { 
    if (!str) return "";
    return str.toString().replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag])); 
}

// ======================= FIESTA Y GOOGLE SHEETS =======================
function parseCSV(text) {
    let r = [], row = [''], q = false;
    for (let i = 0; i < text.length; i++) {
        let c = text[i], next = text[i+1];
        if (c === '"') {
            if (q && next === '"') { row[row.length - 1] += '"'; i++; }
            else { q = !q; }
        } else if (c === ',' && !q) {
            row.push('');
        } else if ((c === '\r' || c === '\n') && !q) {
            if (c === '\r' && next === '\n') { i++; }
            r.push(row); row = [''];
        } else {
            row[row.length - 1] += c;
        }
    }
    if (row.length > 1 || row[0] !== '') r.push(row);
    return r;
}

function procesarTextoCSVFiesta(csvText) {
    const rows = parseCSV(csvText.trim());
    if (rows.length < 2) return [];

    let invitados = [];
    for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (r.length < 3) continue;
        const nombre = (r[1] || '').trim();
        const asiste = (r[2] || '').trim().toLowerCase();
        const parejaVal = (r[3] || '').trim().toLowerCase();

        if (!nombre) continue;
        const siAsiste = asiste.includes('si') || asiste.includes('sí');
        if (!siAsiste) continue;

        const tienePareja = parejaVal === 'si' || parejaVal === 'sí';

        invitados.push({ nombre: nombre, es_pareja: false, nombre_principal: nombre });
        if (tienePareja) {
            invitados.push({ nombre: `Pareja de ${nombre}`, es_pareja: true, nombre_principal: nombre });
        }
    }
    return invitados;
}

async function cargarDatosFiesta() {
    try {
        let fetchUrl = `${SCRIPT_URL}?action=proxy_csv&url=${encodeURIComponent(GOOGLE_SHEET_FIESTA_CSV)}`;
        let res = await fetch(fetchUrl);
        if (!res.ok) throw new Error();
        let text = await res.text();
        
        if (text && text.length > 20) {
            localStorage.setItem('cacheFiestaCSV', text);
            listaInvitadosFiesta = procesarTextoCSVFiesta(text);
        }
    } catch (e) {
        let cached = localStorage.getItem('cacheFiestaCSV');
        if (cached) {
            listaInvitadosFiesta = procesarTextoCSVFiesta(cached);
        }
    }
    actualizarContadoresFiesta();
    dibujarTablaFiesta();
}

function actualizarContadoresFiesta() {
    const total = listaInvitadosFiesta.length;
    setText('val-fiesta', total);
    setText('tab-count-fiesta', total);
    setText('fiesta-banquet-val', total);
}

function dibujarTablaFiesta() {
    const inputBuscador = document.getElementById('buscador-fiesta');
    const term = inputBuscador ? quitarTildes(inputBuscador.value) : "";
    let html = "";
    let idx = 1;

    listaInvitadosFiesta.forEach(f => {
        if (term === "" || quitarTildes(f.nombre).includes(term)) {
            html += `<tr ${f.es_pareja ? 'style="background-color: #fdfbf7;"' : ''}>
                <td class="text-muted fw-bold">${idx++}</td>
                <td class="${f.es_pareja ? 'ps-4' : ''}">
                    ${f.es_pareja ? '<span class="text-muted me-1">↳</span>' : ''}
                    <strong ${f.es_pareja ? 'class="fw-semibold text-secondary"' : ''}>${escapeHTML(f.nombre)}</strong>
                </td>
                <td>
                    <span class="badge ${f.es_pareja ? 'bg-secondary' : 'text-white'}" style="${!f.es_pareja ? 'background:var(--fiesta-color);' : ''}">
                        ${f.es_pareja ? 'Pareja' : 'Titular'}
                    </span>
                </td>
            </tr>`;
        }
    });

    const tablaFiestaEl = document.getElementById('tabla-fiesta');
    if (tablaFiestaEl) tablaFiestaEl.innerHTML = html || `<tr><td colspan="3" class="text-center text-muted py-4">No hay invitados de fiesta registrados.</td></tr>`;
}

function exportarExcelFiesta() {
    let data = listaInvitadosFiesta.map((f, i) => ({
        "#": i + 1, "Nombre": f.nombre, "Tipo": f.es_pareja ? "Pareja" : "Titular"
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Invitados Fiesta");
    XLSX.writeFile(wb, "Matrimonio_Fiesta.xlsx");
}

// ======================= AUTO-HEALING DE MESAS =======================
function reconciliarMesasHuerfanas() {
    if (!dataMesas.some(m => parseInt(m.numero) === 1)) {
        dataMesas.unshift({ numero: 1, capacidad: 10, alias: 'Mesa de los Novios' });
    }

    const numerosDetectados = new Set();
    listaComensalesGenerales.forEach(c => {
        if (c.mesa !== null && c.mesa !== undefined && c.mesa !== "") {
            const n = parseInt(c.mesa);
            if (!isNaN(n) && n > 0) numerosDetectados.add(n);
        }
    });

    let huboRescate = false;
    numerosDetectados.forEach(numMesa => {
        if (!dataMesas.some(m => parseInt(m.numero) === numMesa)) {
            dataMesas.push({ numero: numMesa, capacidad: 10, alias: '' });
            huboRescate = true;
        }
    });

    dataMesas.forEach(m => {
        if (!m.capacidad || isNaN(parseInt(m.capacidad))) m.capacidad = 10;
        if (parseInt(m.numero) === 1 && !m.alias) m.alias = 'Mesa de los Novios';
    });

    dataMesas.sort((a, b) => parseInt(a.numero) - parseInt(b.numero));

    if (huboRescate) {
        marcarCambioPendienteMesas();
    }
}

// ======================= CARGA INICIAL =======================
async function init() {
    const relojEl = document.getElementById('reloj-guardado');
    if (relojEl) relojEl.innerHTML = `<span class="text-muted"><i class="bi bi-arrow-repeat spin me-1"></i>Conectando al sistema...</span>`;

    try {
        const resCfg = await fetch('config.json').catch(() => null); 
        if (resCfg && resCfg.ok) {
            const cfg = await resCfg.json();
            if (cfg && cfg.worker_url) SCRIPT_URL = cfg.worker_url;
        }
    } catch(e) {}

    try {
        await cargarDatos();
        cargarDatosFiesta().catch(e => console.warn("Fiesta sync:", e));
        processQueue();
        actualizarBotonUndo();
    } catch(e) {
        console.error("Error inicial:", e);
        if (relojEl) relojEl.innerHTML = `<span class="text-danger"><i class="bi bi-x-circle me-1"></i>Sin conexión</span>`;
    }
}

async function cargarDatos() {
    const relojEl = document.getElementById('reloj-guardado');
    try {
        const [resM, resConf, resCanc, resMesas] = await Promise.all([
            fetch(`${SCRIPT_URL}?action=lista`).then(r => r.json()).catch(() => []),
            fetch(`${SCRIPT_URL}?action=confirmados`).then(r => r.json()).catch(() => []),
            fetch(`${SCRIPT_URL}?action=cancelados`).then(r => r.json()).catch(() => []),
            fetch(`${SCRIPT_URL}?action=mesas`).then(r => r.json()).catch(() => [])
        ]);

        dataMaestra = Array.isArray(resM) ? resM : [];
        dataConfirmados = Array.isArray(resConf) ? resConf : [];
        dataCancelados = Array.isArray(resCanc) ? resCanc : [];
        dataMesas = Array.isArray(resMesas) ? resMesas : [];

        // Migrar cualquier mesa 0 histórica a Mesa 1
        const mesaCero = dataMesas.find(m => parseInt(m.numero) === 0);
        if (mesaCero) {
            dataConfirmados.forEach(c => {
                if (parseInt(c.mesa_numero) === 0) c.mesa_numero = 1;
                if (parseInt(c.mesa_pareja) === 0) c.mesa_pareja = 1;
            });
            const mesaUno = dataMesas.find(m => parseInt(m.numero) === 1);
            if (mesaUno) {
                mesaUno.alias = mesaCero.alias || "Mesa de los Novios";
            } else {
                mesaCero.numero = 1;
                mesaCero.alias = mesaCero.alias || "Mesa de los Novios";
            }
            dataMesas = dataMesas.filter(m => parseInt(m.numero) !== 0);
        }

        procesarDatosGenerales(); 
        reconciliarMesasHuerfanas();

        dibujarPanelBanqueteria(); 
        dibujarPanelConfirmaciones(); 
        dibujarPanelMesas();
        dibujarTablaListaMaestra();

        if (relojEl) {
            relojEl.innerHTML = `<span class="text-success"><i class="bi bi-shield-check me-1"></i>Sistema conectado (${dataConfirmados.length} confirmados · ${dataMesas.length} mesas)</span>`;
        }
    } catch(e) { 
        console.error("Error en cargarDatos:", e); 
        if (relojEl) relojEl.innerHTML = `<span class="text-danger"><i class="bi bi-exclamation-triangle-fill me-1"></i>Error: ${escapeHTML(e.message)}</span>`;
    }
}

function procesarDatosGenerales() {
    listaComensalesGenerales = []; 
    listaCancelables = []; 
    listaPendientes = [];
    listaDesglosadaMaestra = [];

    dataMaestra.forEach(m => {
        listaCancelables.push({ nombre_mostrar: m.nombre, nombre_principal: m.nombre, es_pareja: false });

        const mNomNorm = quitarTildes(m.nombre);
        const conf = dataConfirmados.find(c => quitarTildes(c.nombre_invitado) === mNomNorm);
        const estaConfirmado = !!conf;
        const titularCancelado = dataCancelados.some(c => quitarTildes(c.nombre) === mNomNorm);

        let estadoTitular = 'Pendiente';
        if (estaConfirmado) estadoTitular = 'Confirmado';
        else if (titularCancelado) estadoTitular = 'Cancelado';

        const ladoInvitado = m.lado || 'Novio';

        listaDesglosadaMaestra.push({
            id_maestra: m.id,
            nombre: m.nombre,
            nombre_principal: m.nombre,
            es_pareja: false,
            pareja_activa: parseInt(m.pareja) === 1,
            nino: parseInt(m.nino) === 1,
            lado: ladoInvitado,
            estado: estadoTitular
        });

        if (parseInt(m.pareja) === 1) {
            const parejaConfirmada = conf && conf.lleva_pareja === "Sí";
            const nombreParejaPotencial = (conf && conf.nombre_pareja && conf.nombre_pareja !== '-' && conf.nombre_pareja.toLowerCase() !== 'pendiente') 
                ? conf.nombre_pareja 
                : `Pareja de ${m.nombre}`;

            const parejaCancelada = dataCancelados.some(c => {
                const cNom = quitarTildes(c.nombre);
                return cNom === quitarTildes(nombreParejaPotencial) || 
                       cNom === quitarTildes(`Pareja de ${m.nombre}`);
            });

            let estadoPareja = 'Pendiente';
            if (parejaConfirmada) estadoPareja = 'Confirmado';
            else if (parejaCancelada) estadoPareja = 'Cancelado';

            listaDesglosadaMaestra.push({
                id_maestra: m.id,
                nombre: nombreParejaPotencial,
                nombre_principal: m.nombre,
                es_pareja: true,
                pareja_activa: true,
                nino: false,
                lado: ladoInvitado,
                estado: estadoPareja
            });

            if (!parejaConfirmada && !parejaCancelada) {
                listaPendientes.push({
                    nombre: nombreParejaPotencial,
                    tipo: 'Pareja',
                    nombre_principal: m.nombre,
                    es_pareja: true,
                    lado: ladoInvitado,
                    tiene_pareja_maestra: true
                });
            }
        }

        if (!estaConfirmado && !titularCancelado) {
            listaPendientes.push({
                nombre: m.nombre,
                tipo: 'Titular',
                nombre_principal: m.nombre,
                es_pareja: false,
                lado: ladoInvitado,
                tiene_pareja_maestra: parseInt(m.pareja) === 1
            });
        }
    });

    dataConfirmados.forEach(c => {
        const cNomNorm = quitarTildes(c.nombre_invitado);
        const infoMaestra = dataMaestra.find(m => quitarTildes(m.nombre) === cNomNorm);
        const esNinoTitular = infoMaestra ? (infoMaestra.nino === 1) : false;
        const ladoTitular = infoMaestra ? (infoMaestra.lado || 'Novio') : 'Novio';
        
        listaComensalesGenerales.push({
            id_drag: `prin_${c.nombre_invitado}`,
            nombre_mostrar: c.nombre_invitado,
            nombre_principal: c.nombre_invitado,
            es_pareja: false,
            mesa: (c.mesa_numero !== null && c.mesa_numero !== undefined && c.mesa_numero !== "") ? parseInt(c.mesa_numero) : null,
            asiento_numero: (c.asiento_numero !== null && c.asiento_numero !== undefined && c.asiento_numero !== "") ? parseInt(c.asiento_numero) : null,
            dieta: c.dieta || 'Ninguna',
            esNino: esNinoTitular,
            lado: ladoTitular,
            telefono: c.telefono,
            lleva_pareja: c.lleva_pareja
        });

        if (c.lleva_pareja === "Sí") {
            let nombreP = (c.nombre_pareja && c.nombre_pareja !== "-" && c.nombre_pareja.toLowerCase() !== "pendiente") 
                ? `${c.nombre_pareja}` 
                : `Pareja de ${c.nombre_invitado}`;
                
            listaComensalesGenerales.push({
                id_drag: `par_${c.nombre_invitado}`,
                nombre_mostrar: nombreP,
                nombre_principal: c.nombre_invitado,
                es_pareja: true,
                mesa: (c.mesa_pareja !== null && c.mesa_pareja !== undefined && c.mesa_pareja !== "") ? parseInt(c.mesa_pareja) : null,
                asiento_numero: (c.asiento_pareja !== null && c.asiento_pareja !== undefined && c.asiento_pareja !== "") ? parseInt(c.asiento_pareja) : null,
                dieta: c.dieta_pareja || 'Ninguna',
                esNino: false,
                lado: ladoTitular,
                telefono: "-"
            });
            listaCancelables.push({ nombre_mostrar: nombreP, nombre_principal: c.nombre_invitado, es_pareja: true });
        }
    });
}

// ======================= GUARDADO EN BLOQUE (BATCH) =======================
async function ejecutarGuardadoSilencioso() {
    if (!hayCambiosMesas) return;
    try {
        const payload = prepararPayloadMesas();
        await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        marcarCambiosGuardadosMesas();
    } catch(e) {
        console.warn("Auto-guardado pendiente...", e);
    }
}

async function guardarCambiosEnBBDD() {
    const btn = document.getElementById('btn-guardar-cambios-mesas');
    const btnTexto = document.getElementById('btn-guardar-texto');
    if (btn) btn.disabled = true;
    if (btnTexto) btnTexto.innerText = "Guardando...";

    try {
        reconciliarMesasHuerfanas();
        const payload = prepararPayloadMesas();
        const res = await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const resJson = await res.json();
        if (resJson.error) throw new Error(resJson.error);

        marcarCambiosGuardadosMesas();
        alert("✅ ¡Todos los cambios han sido guardados con éxito!");
    } catch(err) {
        console.error("Error guardando mesas:", err);
        alert("❌ Error al guardar: " + err.message);
        marcarCambioPendienteMesas();
    } finally {
        if (btn) btn.disabled = false;
    }
}

function prepararPayloadMesas() {
    reconciliarMesasHuerfanas();

    const mesasPayload = dataMesas.map(m => ({
        numero: parseInt(m.numero),
        capacidad: parseInt(m.capacidad) || 10,
        alias: m.alias || ''
    }));

    const asignacionesPayload = listaComensalesGenerales.map(c => ({
        nombre_principal: c.nombre_principal,
        es_pareja: c.es_pareja,
        mesa_numero: (c.mesa !== null && c.mesa !== undefined && c.mesa !== "") ? parseInt(c.mesa) : null,
        asiento_numero: (c.asiento_numero !== null && c.asiento_numero !== undefined && c.asiento_numero !== "") ? parseInt(c.asiento_numero) : null
    }));

    return {
        tipo: "guardar_todo_mesas",
        mesas: mesasPayload,
        asignaciones: asignacionesPayload
    };
}

// ======================= MESAS (MESA 1 FIJA + DESPLAZAMIENTO 2..N) =======================
function obtenerProximoNumeroDisponible() {
    reconciliarMesasHuerfanas();
    const ocupados = dataMesas.map(m => parseInt(m.numero)).filter(n => n >= 2);
    let proximo = 2;
    while (ocupados.includes(proximo)) proximo++;
    return proximo;
}

function ejecutarCambioNumeroMesa(viejoNum, nuevoNumDeseado) {
    viejoNum = parseInt(viejoNum);
    nuevoNumDeseado = parseInt(nuevoNumDeseado);

    if (isNaN(viejoNum) || isNaN(nuevoNumDeseado) || viejoNum === nuevoNumDeseado) return;
    if (viejoNum === 1 || nuevoNumDeseado === 1) {
        alert("La Mesa 1 es la Mesa de los Novios y no se puede mover.");
        return;
    }

    guardarSnapshotUndo();
    reconciliarMesasHuerfanas();

    const mesa1 = dataMesas.find(m => parseInt(m.numero) === 1);
    let mesasNormales = dataMesas.filter(m => parseInt(m.numero) >= 2);

    const indexOrigen = mesasNormales.findIndex(m => parseInt(m.numero) === viejoNum);
    if (indexOrigen === -1) return;

    const [mesaMovida] = mesasNormales.splice(indexOrigen, 1);

    let indexDestino = mesasNormales.findIndex(m => parseInt(m.numero) === nuevoNumDeseado);
    if (indexDestino === -1) {
        mesasNormales.push(mesaMovida);
    } else {
        mesasNormales.splice(indexDestino, 0, mesaMovida);
    }

    const mapaCambios = {};
    mesasNormales.forEach((m, idx) => {
        const numAnterior = parseInt(m.numero);
        const numNuevo = idx + 2;
        if (numAnterior !== numNuevo) {
            mapaCambios[numAnterior] = numNuevo;
            m.numero = numNuevo;
        }
    });

    listaComensalesGenerales.forEach(c => {
        if (c.mesa !== null && mapaCambios[parseInt(c.mesa)]) {
            c.mesa = mapaCambios[parseInt(c.mesa)];
        }
    });

    dataMesas = mesa1 ? [mesa1, ...mesasNormales] : mesasNormales;
    dibujarPanelMesas();
    dibujarPanelBanqueteria();
    marcarCambioPendienteMesas();
}

function renumerarMesasContiguas() {
    guardarSnapshotUndo();
    reconciliarMesasHuerfanas();

    const mesa1 = dataMesas.find(m => parseInt(m.numero) === 1);
    let mesasNormales = dataMesas.filter(m => parseInt(m.numero) >= 2);

    const mapaCambios = {};
    mesasNormales.forEach((m, idx) => {
        const numAnterior = parseInt(m.numero);
        const numNuevo = idx + 2;
        if (numAnterior !== numNuevo) {
            mapaCambios[numAnterior] = numNuevo;
            m.numero = numNuevo;
        }
    });

    listaComensalesGenerales.forEach(c => {
        if (c.mesa !== null && mapaCambios[parseInt(c.mesa)]) {
            c.mesa = mapaCambios[parseInt(c.mesa)];
        }
    });

    dataMesas = mesa1 ? [mesa1, ...mesasNormales] : mesasNormales;
    dibujarPanelMesas();
    dibujarPanelBanqueteria();
    marcarCambioPendienteMesas();
    alert(`✅ Mesas renumeradas consecutivamente del 2 al ${dataMesas.length}. Cualquier salto de números fue corregido.`);
}

function eliminarMesa(num) { 
    num = parseInt(num);
    if (num === 1) return alert("La Mesa 1 de los Novios no se puede eliminar.");
    if(!confirm(`¿Eliminar la Mesa ${num}? Sus comensales volverán a 'Por Asignar' y las mesas siguientes se compactarán automáticamente.`)) return; 

    guardarSnapshotUndo();
    reconciliarMesasHuerfanas();

    listaComensalesGenerales.forEach(c => { 
        if(parseInt(c.mesa) === num) {
            c.mesa = null;
            c.asiento_numero = null;
        }
    });

    const mesa1 = dataMesas.find(m => parseInt(m.numero) === 1);
    let mesasNormales = dataMesas.filter(m => parseInt(m.numero) >= 2 && parseInt(m.numero) !== num);

    const mapaCambios = {};
    mesasNormales.forEach((m, idx) => {
        const numAnterior = parseInt(m.numero);
        const numNuevo = idx + 2;
        if (numAnterior !== numNuevo) {
            mapaCambios[numAnterior] = numNuevo;
            m.numero = numNuevo;
        }
    });

    listaComensalesGenerales.forEach(c => {
        if (c.mesa !== null && mapaCambios[parseInt(c.mesa)]) {
            c.mesa = mapaCambios[parseInt(c.mesa)];
        }
    });

    dataMesas = mesa1 ? [mesa1, ...mesasNormales] : mesasNormales;
    dibujarPanelMesas(); 
    dibujarPanelBanqueteria(); 
    marcarCambioPendienteMesas();
}

function dibujarPanelMesas() {
    reconciliarMesasHuerfanas();
    actualizarKPIMesas();
    dibujarListaSinAsignar();
    dibujarGridMesas();
    dibujarResumenMesasBanqueteria();
}

function actualizarKPIMesas() {
    const sinAsignar = listaComensalesGenerales.filter(c => c.mesa === null || c.mesa === "");
    let sillasTotales = 0, sillasOcupadas = 0;
    
    dataMesas.forEach(m => {
        const ocupantes = listaComensalesGenerales.filter(c => c.mesa !== null && parseInt(c.mesa) === parseInt(m.numero)).length;
        sillasOcupadas += ocupantes;
        sillasTotales += (parseInt(m.capacidad) || 10);
    });

    const pct = sillasTotales > 0 ? Math.round((sillasOcupadas / sillasTotales) * 100) : 0;
    setText('kpi-mesas-totales', dataMesas.length);
    setText('kpi-sillas-ocupadas', sillasOcupadas);
    setText('kpi-sillas-totales', sillasTotales);
    setText('kpi-pct-ocupacion', `${pct}%`);
    setText('kpi-sin-mesa', sinAsignar.length);
    setText('count-sin-asignar', sinAsignar.length);
}

// FILTRO EN LA BANDEJA IZQUIERDA POR NOVIO O NOVIA
function filtrarSinAsignarLado(lado) {
    filtroSinAsignarLado = lado;
    document.querySelectorAll('[id^="btn-sin-filtro-"]').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById(`btn-sin-filtro-${lado.toLowerCase()}`);
    if (btn) btn.classList.add('active');
    dibujarListaSinAsignar();
}

function dibujarListaSinAsignar() {
    const sinAsignar = listaComensalesGenerales.filter(c => c.mesa === null || c.mesa === "");
    const inputBuscador = document.getElementById('buscador-por-asignar');
    const term = inputBuscador ? quitarTildes(inputBuscador.value) : "";
    
    let html = "";
    sinAsignar.forEach(c => {
        const matchLado = (filtroSinAsignarLado === 'todos') || (c.lado === filtroSinAsignarLado) || (c.lado === 'Ambos');
        const matchSearch = term === "" || quitarTildes(c.nombre_mostrar).includes(term);

        if (matchLado && matchSearch) {
            const torpedoClass = c.lado === 'Novia' ? 'torpedo-novia' : (c.lado === 'Ambos' ? 'torpedo-ambos' : 'torpedo-novio');
            const torpedoEmoji = c.lado === 'Novia' ? '👰' : (c.lado === 'Ambos' ? '💍' : '🤵');

            html += `
            <div class="guest-item draggable-guest" draggable="true" ondragstart="dragGuest(event, '${c.id_drag}')">
                <div class="d-flex align-items-center text-truncate me-2">
                    <span class="torpedo-badge ${torpedoClass}" title="Lado: ${c.lado}">${torpedoEmoji}</span>
                    <strong class="text-truncate" style="font-size:0.83rem;" title="${escapeHTML(c.nombre_mostrar)}">${escapeHTML(c.nombre_mostrar)}</strong>
                </div>
                <button class="btn btn-outline-dark btn-sm py-0 px-2 flex-shrink-0" style="font-size:0.72rem;" onclick="abrirModalAsignarDirecto('${c.id_drag}')">
                    Sentar
                </button>
            </div>`;
        }
    });

    const listaSinAsignarEl = document.getElementById('lista-sin-asignar');
    if (listaSinAsignarEl) listaSinAsignarEl.innerHTML = html || `<p class="text-muted small mt-2 text-center">Todos tienen mesa asignada.</p>`;
}

function filtrarPorAsignar() { dibujarListaSinAsignar(); }

// RENDER DE MESAS: LIMPIO, CON IDENTIDAD Y MESA 1 NOVIOS
function dibujarGridMesas() {
    let htmlGrid = "";
    dataMesas.forEach(mesa => {
        const num = parseInt(mesa.numero);
        const esMesaNovios = (num === 1);
        const ocupantes = listaComensalesGenerales.filter(c => c.mesa !== null && parseInt(c.mesa) === num);
        const cant = ocupantes.length;
        const cap = parseInt(mesa.capacidad) || 10;
        const estaLlena = (cant >= cap);

        if (filtroMesasEstado === 'disponibles' && estaLlena) return;
        if (filtroMesasEstado === 'llenas' && !estaLlena) return;
        if (filtroMesasEstado === 'novios' && !esMesaNovios) return;

        let htmlOcupantes = "";
        ocupantes.forEach(c => {
            const torpedoClass = c.lado === 'Novia' ? 'torpedo-novia' : (c.lado === 'Ambos' ? 'torpedo-ambos' : 'torpedo-novio');
            const torpedoEmoji = c.lado === 'Novia' ? '👰' : (c.lado === 'Ambos' ? '💍' : '🤵');
            const asientoBadge = c.asiento_numero ? `<span class="badge bg-light text-dark border py-0 px-1 me-1" style="font-size:0.68rem;">Silla ${c.asiento_numero}</span>` : '';

            htmlOcupantes += `
            <div class="guest-item draggable-guest" draggable="true" ondragstart="dragGuest(event, '${c.id_drag}')">
                <div class="d-flex align-items-center text-truncate me-2">
                    <span class="torpedo-badge ${torpedoClass}" title="Lado: ${c.lado}">${torpedoEmoji}</span>
                    ${asientoBadge}
                    <span class="text-truncate fw-semibold" style="font-size:0.82rem;" title="${escapeHTML(c.nombre_mostrar)}">${escapeHTML(c.nombre_mostrar)}</span>
                </div>
                <div class="d-flex align-items-center gap-1 flex-shrink-0">
                    <button class="btn btn-sm btn-light border py-0 px-1 text-muted" title="Mover a otra mesa" onclick="abrirModalAsignarDirecto('${c.id_drag}', ${num})"><i class="bi bi-arrow-left-right" style="font-size:0.75rem;"></i></button>
                    <button class="btn btn-sm text-danger p-0 m-0" title="Quitar de la mesa" onclick="intentarAsignar('${c.id_drag}', null, null, null)"><i class="bi bi-x-circle"></i></button>
                </div>
            </div>`;
        });

        const alias = mesa.alias || (esMesaNovios ? 'Mesa de Honor' : 'Clic para asignar nombre');

        htmlGrid += `
        <div class="col-12 col-md-6 col-xl-4 mb-3 mesa-col-box" id="mesa-col-${num}" 
             ${!esMesaNovios ? `ondragover="allowDropMesa(event)" ondragleave="leaveDropMesa(event)" ondrop="dropMesa(event, ${num})"` : ''}>
            
            <div class="mesa-card ${esMesaNovios ? 'mesa-novios' : ''}">
                <div class="d-flex justify-content-between align-items-center mb-2" ${!esMesaNovios ? `draggable="true" ondragstart="dragMesa(event, ${num})"` : ''}>
                    <div class="d-flex align-items-center gap-2">
                        ${!esMesaNovios ? '<i class="bi bi-arrows-move cursor-move text-muted" title="Arrastra para reordenar esta mesa"></i>' : ''}
                        <div>
                            <h6 class="m-0 fw-bold">${esMesaNovios ? '👑 Mesa 1 (Los Novios)' : `Mesa ${num}`}</h6>
                            <div class="mesa-alias" onclick="editarAliasMesa(${num})">${escapeHTML(alias)}</div>
                        </div>
                        <i class="bi bi-people action-icon ms-1" title="Cambiar Sillas" onclick="cambiarCapacidad(${num}, ${cap})"></i>
                        <i class="bi bi-pencil-square action-icon" title="Renombrar Alias" onclick="editarAliasMesa(${num})"></i>
                        ${!esMesaNovios ? `<i class="bi bi-123 action-icon" title="Cambiar Número de Mesa" onclick="cambiarNumero(${num})"></i>` : ''}
                        ${!esMesaNovios ? `<i class="bi bi-trash action-icon trash-icon" title="Eliminar Mesa" onclick="eliminarMesa(${num})"></i>` : ''}
                    </div>
                    <span class="badge ${estaLlena ? 'bg-danger' : 'bg-success'}">${cant} / ${cap}</span>
                </div>

                <div class="drop-zone mb-2" style="max-height: 250px; overflow-y: auto;" ondragover="allowDropGuest(event)" ondragleave="leaveDropGuest(event)" ondrop="dropGuest(event, ${num}, ${cap}, ${cant})">
                    ${htmlOcupantes || '<div class="text-muted small mt-2 text-center">Mesa vacía</div>'}
                </div>

                <!-- BOTÓN PRINCIPAL: ABRIR PLANO VISUAL DE SILLAS -->
                <button class="btn btn-outline-primary btn-sm w-100 py-1 mb-1 fw-semibold" style="font-size:0.75rem;" onclick="abrirModalPlanoMesa(${num})">
                    <i class="bi bi-diagram-3 me-1"></i>🪑 Ver / Organizar Asientos
                </button>

                <button class="btn btn-outline-dark btn-sm w-100 py-1" style="font-size:0.75rem;" onclick="abrirModalSentarEnMesa(${num}, ${cap}, ${cant})" ${estaLlena ? 'disabled' : ''}>
                    ${estaLlena ? 'Mesa Completa' : '+ Sentar comensal'}
                </button>
            </div>
        </div>`;
    });

    const contenedorMesasEl = document.getElementById('contenedor-mesas');
    if (contenedorMesasEl) contenedorMesasEl.innerHTML = htmlGrid || `<div class="col-12 text-center text-muted py-4">No hay mesas en esta categoría.</div>`;
}

// ======================= DRAG & DROP =======================
function dragGuest(ev, idDrag) {
    ev.stopPropagation();
    ev.dataTransfer.setData("drag-type", "guest");
    ev.dataTransfer.setData("text/plain", idDrag);
}

function allowDropGuest(ev) {
    ev.preventDefault(); ev.stopPropagation();
    const d = ev.target.closest('.drop-zone');
    if (d) d.classList.add('dragover');
}

function leaveDropGuest(ev) {
    const d = ev.target.closest('.drop-zone');
    if (d) d.classList.remove('dragover');
}

function dropGuest(ev, mesaNum, capMax, capActual) {
    ev.preventDefault(); ev.stopPropagation();
    detenerAutoScroll();
    const d = ev.target.closest('.drop-zone');
    if (d) d.classList.remove('dragover');

    if (ev.dataTransfer.getData("drag-type") !== "guest") return;
    const idDrag = ev.dataTransfer.getData("text/plain");
    if (!idDrag) return;
    intentarAsignar(idDrag, mesaNum, capMax, capActual);
}

function dragMesa(ev, mesaNum) {
    if (parseInt(mesaNum) === 1) { ev.preventDefault(); return; }
    ev.stopPropagation();
    ev.dataTransfer.setData("drag-type", "mesa");
    ev.dataTransfer.setData("text/plain", mesaNum.toString());
}

function allowDropMesa(ev) {
    if (ev.dataTransfer.types.includes("drag-type")) {
        ev.preventDefault();
        const card = ev.currentTarget.querySelector('.mesa-card');
        if (card && !card.classList.contains('mesa-novios')) card.classList.add('highlight-mesa');
    }
}

function leaveDropMesa(ev) {
    const card = ev.currentTarget.querySelector('.mesa-card');
    if (card) card.classList.remove('highlight-mesa');
}

function dropMesa(ev, targetMesaNum) {
    ev.preventDefault(); ev.stopPropagation();
    detenerAutoScroll();
    const card = ev.currentTarget.querySelector('.mesa-card');
    if (card) card.classList.remove('highlight-mesa');

    if (ev.dataTransfer.getData("drag-type") !== "mesa") return;
    const origenNum = parseInt(ev.dataTransfer.getData("text/plain"));
    const destinoNum = parseInt(targetMesaNum);

    if (origenNum === 1 || destinoNum === 1) return;
    if (origenNum !== destinoNum) {
        ejecutarCambioNumeroMesa(origenNum, destinoNum);
    }
}

// ASIGNACIÓN INTELIGENTE CON SUBIDA AUTOMÁTICA DE PAREJAS
function intentarAsignar(idDrag, mesaNum, capMax, capActual, autoPareja = true) {
    if(!idDrag) return; 
    const comensal = listaComensalesGenerales.find(c => c.id_drag === idDrag); 
    if (!comensal) return;
    
    if (mesaNum !== null && comensal.mesa !== null && parseInt(comensal.mesa) === parseInt(mesaNum)) return;

    guardarSnapshotUndo();

    if (mesaNum === null) {
        comensal.mesa = null;
        comensal.asiento_numero = null;
        dibujarPanelMesas();
        dibujarPanelBanqueteria();
        marcarCambioPendienteMesas();
        return;
    }

    // Detectar si tiene pareja sin mesa asignada
    let companero = null;
    if (autoPareja) {
        if (comensal.es_pareja) {
            companero = listaComensalesGenerales.find(c => c.nombre_principal === comensal.nombre_principal && !c.es_pareja && (c.mesa === null || c.mesa === ""));
        } else {
            companero = listaComensalesGenerales.find(c => c.nombre_principal === comensal.nombre_principal && c.es_pareja && (c.mesa === null || c.mesa === ""));
        }
    }

    const mesaObj = dataMesas.find(m => parseInt(m.numero) === parseInt(mesaNum));
    const cap = mesaObj ? (parseInt(mesaObj.capacidad) || 10) : 10;
    const ocupados = listaComensalesGenerales.filter(c => c.mesa !== null && parseInt(c.mesa) === parseInt(mesaNum)).length;
    const esNovios = (parseInt(mesaNum) === 1);

    if (companero) {
        const disponibles = cap - ocupados;
        if (esNovios || disponibles >= 2) {
            comensal.mesa = mesaNum;
            companero.mesa = mesaNum;
        } else if (disponibles === 1) {
            if (confirm(`La Mesa ${mesaNum} solo tiene 1 asiento libre.\n¿Deseas sentar solo a ${comensal.nombre_mostrar} sin su pareja?`)) {
                comensal.mesa = mesaNum;
            } else {
                return;
            }
        } else {
            alert(`¡Faltan sillas! La Mesa ${mesaNum} está completa.`);
            return;
        }
    } else {
        if (!esNovios && ocupados + 1 > cap) {
            alert(`¡Faltan sillas! Solo quedan ${cap - ocupados} disponibles.`);
            return;
        }
        comensal.mesa = mesaNum;
    }

    dibujarPanelMesas(); 
    dibujarPanelBanqueteria(); 
    marcarCambioPendienteMesas();
}

function cambiarNumero(viejoNum) {
    if (parseInt(viejoNum) === 1) return alert("La Mesa 1 de los Novios no se puede cambiar de número.");
    const nuevoNum = prompt(`Mover Mesa ${viejoNum} al número:`); 
    if(!nuevoNum || isNaN(nuevoNum)) return;
    ejecutarCambioNumeroMesa(parseInt(viejoNum), parseInt(nuevoNum));
}

function crearMesaNormal() {
    guardarSnapshotUndo();
    const inputCap = document.getElementById('nueva-mesa-cap');
    const cap = inputCap ? inputCap.value : "10";
    const num = obtenerProximoNumeroDisponible();
    dataMesas.push({ numero: num, capacidad: parseInt(cap) || 10, alias: '' });
    dataMesas.sort((a, b) => parseInt(a.numero) - parseInt(b.numero));
    dibujarPanelMesas();
    marcarCambioPendienteMesas();
}

function cambiarCapacidad(numero, capActual) {
    guardarSnapshotUndo();
    const nuevaCap = prompt(`Nueva cantidad de sillas:`, capActual); 
    if(!nuevaCap || isNaN(nuevaCap) || parseInt(nuevaCap) <= 0) return;
    const mesa = dataMesas.find(m => parseInt(m.numero) === parseInt(numero)); 
    if(mesa) mesa.capacidad = parseInt(nuevaCap); 
    dibujarPanelMesas(); 
    marcarCambioPendienteMesas();
}

function editarAliasMesa(num) {
    const mesaObj = dataMesas.find(m => parseInt(m.numero) === parseInt(num));
    const actual = mesaObj ? (mesaObj.alias || "") : "";
    const nuevo = prompt(`Asigna un nombre o alias a la Mesa ${num}:`, actual);
    if(nuevo === null) return;
    
    guardarSnapshotUndo();
    if(mesaObj) mesaObj.alias = nuevo.trim();
    dibujarGridMesas();
    dibujarResumenMesasBanqueteria();
    marcarCambioPendienteMesas();
}

// ======================= BUSCADOR 3 EN 1 =======================
function buscarComensalEnMesas(val) {
    const term = quitarTildes(val);
    document.querySelectorAll('.mesa-card').forEach(card => card.classList.remove('highlight-mesa'));
    if(term.length < 2) return;

    // 1. Buscar por nombre de comensal
    const comensal = listaComensalesGenerales.find(c => c.mesa !== null && quitarTildes(c.nombre_mostrar).includes(term));
    let mesaObjetivo = comensal ? parseInt(comensal.mesa) : null;

    // 2. Buscar por alias o número de mesa si no coincide con comensal
    if (!mesaObjetivo) {
        const mesa = dataMesas.find(m => {
            const aliasMatch = m.alias && quitarTildes(m.alias).includes(term);
            const numMatch = `mesa ${m.numero}`.includes(term) || (term === m.numero.toString());
            return aliasMatch || numMatch;
        });
        if (mesa) mesaObjetivo = parseInt(mesa.numero);
    }

    if (mesaObjetivo !== null) {
        const mesaCol = document.getElementById(`mesa-col-${mesaObjetivo}`);
        if (mesaCol) {
            const card = mesaCol.querySelector('.mesa-card');
            if (card) {
                card.classList.add('highlight-mesa');
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }
}

function filtrarMesasVista(tipo) {
    filtroMesasEstado = tipo;
    document.querySelectorAll('[id^="filtro-mesa-"]').forEach(btn => btn.classList.remove('active'));
    const btnActivo = document.getElementById(`filtro-mesa-${tipo}`);
    if (btnActivo) btnActivo.classList.add('active');
    dibujarGridMesas();
}

// ======================= MODAL SENTAR 1-CLIC =======================
function abrirModalAsignarDirecto(idDrag, mesaActual = null) {
    const comensal = listaComensalesGenerales.find(c => c.id_drag === idDrag);
    if(!comensal) return;
    comensalModalActivo = comensal;

    setText('modalMoverMesaTitulo', `Asignar a: ${comensal.nombre_mostrar}`);
    setText('modalMoverMesaSubtitulo', mesaActual !== null ? `Actualmente en Mesa ${mesaActual}.` : `Aún no tiene mesa asignada.`);

    const select = document.getElementById('select-destino-mesa');
    if (!select) return;
    select.innerHTML = "";

    if (mesaActual !== null) {
        const optSin = document.createElement('option');
        optSin.value = "desasignar";
        optSin.innerText = "❌ Quitar de la mesa (Mover a 'Por Asignar')";
        select.appendChild(optSin);
    }

    dataMesas.forEach(m => {
        const num = parseInt(m.numero);
        const esNovios = (num === 1);
        const ocupantes = listaComensalesGenerales.filter(c => c.mesa !== null && parseInt(c.mesa) === num).length;
        const cap = parseInt(m.capacidad) || 10;
        const alias = m.alias ? ` (${m.alias})` : '';

        const opt = document.createElement('option');
        opt.value = num;
        opt.innerText = esNovios ? `👑 Mesa 1: Los Novios${alias} — (${ocupantes}/${cap})` : `Mesa ${num}${alias} — (${ocupantes}/${cap})`;
        
        if (ocupantes >= cap && num !== mesaActual) {
            opt.disabled = true;
            opt.innerText += " [LLENA]";
        }
        if (num === mesaActual) opt.selected = true;
        select.appendChild(opt);
    });

    new bootstrap.Modal(document.getElementById('modalMoverMesa')).show();
}

function ejecutarMoverDesdeModal() {
    if(!comensalModalActivo) return;
    const select = document.getElementById('select-destino-mesa');
    const selectVal = select ? select.value : "";
    const modalEl = document.getElementById('modalMoverMesa');
    if (modalEl) bootstrap.Modal.getInstance(modalEl).hide();

    if (selectVal === "desasignar") {
        intentarAsignar(comensalModalActivo.id_drag, null, null, null);
    } else {
        const mesaNum = parseInt(selectVal);
        const mesaObj = dataMesas.find(m => parseInt(m.numero) === mesaNum);
        const cap = mesaObj ? (parseInt(mesaObj.capacidad) || 10) : 10;
        const ocupados = listaComensalesGenerales.filter(c => c.mesa !== null && parseInt(c.mesa) === mesaNum).length;
        intentarAsignar(comensalModalActivo.id_drag, mesaNum, cap, ocupados);
    }
}

let candidatosSinMesaGlobal = [];
function abrirModalSentarEnMesa(numMesa, capMax, capActual) {
    mesaModalActiva = { num: numMesa, capMax: capMax, capActual: capActual };
    candidatosSinMesaGlobal = listaComensalesGenerales.filter(c => c.mesa === null || c.mesa === "");
    
    setText('modalSentarMesaTitulo', (numMesa === 1) ? `Sentar en Mesa 1 (Los Novios)` : `Sentar en Mesa ${numMesa}`);
    renderListaModalSinAsignar(candidatosSinMesaGlobal);
    new bootstrap.Modal(document.getElementById('modalSentarEnMesa')).show();
}

function renderListaModalSinAsignar(lista) {
    const cont = document.getElementById('modal-lista-candidatos');
    if (!cont) return;
    if(lista.length === 0) {
        cont.innerHTML = `<div class="p-3 text-center text-muted small">No hay comensales sin mesa.</div>`;
        return;
    }
    let html = "";
    lista.forEach(c => {
        const torpedoClass = c.lado === 'Novia' ? 'torpedo-novia' : (c.lado === 'Ambos' ? 'torpedo-ambos' : 'torpedo-novio');
        const torpedoEmoji = c.lado === 'Novia' ? '👰' : (c.lado === 'Ambos' ? '💍' : '🤵');

        html += `
        <button type="button" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center" onclick="ejecutarSentarDesdeModal('${c.id_drag}')">
            <div class="d-flex align-items-center">
                <span class="torpedo-badge ${torpedoClass}">${torpedoEmoji}</span>
                <div>
                    <strong style="font-size:0.88rem;">${escapeHTML(c.nombre_mostrar)}</strong>
                    <div class="small text-muted">${c.es_pareja ? 'Pareja' : 'Titular'}</div>
                </div>
            </div>
            <span class="btn btn-sm btn-gold py-0 px-2">Sentar</span>
        </button>`;
    });
    cont.innerHTML = html;
}

function filtrarModalSinAsignar(val) {
    const term = quitarTildes(val);
    renderListaModalSinAsignar(candidatosSinMesaGlobal.filter(c => quitarTildes(c.nombre_mostrar).includes(term)));
}

function ejecutarSentarDesdeModal(idDrag) {
    if(!mesaModalActiva) return;
    const modalEl = document.getElementById('modalSentarEnMesa');
    if (modalEl) bootstrap.Modal.getInstance(modalEl).hide();
    intentarAsignar(idDrag, mesaModalActiva.num, mesaModalActiva.capMax, mesaModalActiva.capActual);
}

// =========================================================================
//   PLANO VISUAL GRÁFICO ("ABRIR MESA" - CIRCULAR Y RECTANGULAR NOVIO)
// =========================================================================
function abrirModalPlanoMesa(numMesa) {
    mesaPlanoActiva = parseInt(numMesa);
    const mesaObj = dataMesas.find(m => parseInt(m.numero) === mesaPlanoActiva);
    if (!mesaObj) return;

    const cap = parseInt(mesaObj.capacidad) || 10;
    const ocupantes = listaComensalesGenerales.filter(c => c.mesa !== null && parseInt(c.mesa) === mesaPlanoActiva);
    const esNovios = (mesaPlanoActiva === 1);

    setText('modalPlanoMesaTitulo', esNovios ? `👑 Mesa 1 (Los Novios) - Plano de Asientos` : `Mesa ${numMesa} (${mesaObj.alias || 'Sin alias'}) - Plano de Asientos`);
    setText('modalPlanoMesaSubtitulo', esNovios ? 'Mesa rectangular con cabeceras y sillas alrededor' : 'Mesa redonda con sillas perimetrales');
    setText('modal-plano-count', `${ocupantes.length}/${cap}`);

    // Lista izquierda de comensales en la mesa
    let htmlLista = "";
    ocupantes.forEach((c) => {
        const torpedoClass = c.lado === 'Novia' ? 'torpedo-novia' : (c.lado === 'Ambos' ? 'torpedo-ambos' : 'torpedo-novio');
        const torpedoEmoji = c.lado === 'Novia' ? '👰' : (c.lado === 'Ambos' ? '💍' : '🤵');
        const asignado = (c.asiento_numero !== null && c.asiento_numero !== undefined);

        htmlLista += `
        <div class="member-row-item ${asignado ? 'is-seated' : 'is-unseated'} d-flex justify-content-between align-items-center">
            <div class="d-flex align-items-center text-truncate me-2" draggable="true" ondragstart="dragGuestPlano(event, '${c.id_drag}')" style="cursor:grab;">
                <span class="torpedo-badge ${torpedoClass}">${torpedoEmoji}</span>
                <div class="text-truncate">
                    <span class="small fw-semibold text-truncate d-block">${escapeHTML(c.nombre_mostrar)}</span>
                    <small class="text-muted" style="font-size:0.68rem;">${asignado ? `<span class="text-success font-monospace fw-bold">Silla ${c.asiento_numero}</span>` : 'Sin silla asignada'}</small>
                </div>
            </div>
            <div class="d-flex align-items-center gap-1">
                ${asignado ? `<button class="btn btn-sm btn-light border py-0 px-1 text-muted" title="Quitar de la silla" onclick="desasignarSilla('${c.id_drag}')"><i class="bi bi-person-x"></i></button>` : ''}
                <button class="btn btn-sm btn-outline-danger py-0 px-1" title="Quitar de la mesa completa" onclick="intentarAsignar('${c.id_drag}', null, null, null); abrirModalPlanoMesa(${mesaPlanoActiva});"><i class="bi bi-x-lg"></i></button>
            </div>
        </div>`;
    });

    const listaEl = document.getElementById('modal-plano-lista-comensales');
    if (listaEl) listaEl.innerHTML = htmlLista || `<div class="p-3 text-muted small text-center">No hay comensales en esta mesa.</div>`;

    // Renderizado del plano gráfico a la derecha
    const canvas = document.getElementById('modal-plano-mapa-grafico');
    if (!canvas) return;
    canvas.innerHTML = "";

    if (esNovios) {
        dibujarMesaRectangularNovios(canvas, cap, ocupantes);
    } else {
        dibujarMesaRedondaNormal(canvas, cap, ocupantes);
    }

    new bootstrap.Modal(document.getElementById('modalPlanoMesa')).show();
}

function abrirSentarDesdePlano() {
    if (!mesaPlanoActiva) return;
    const mesaObj = dataMesas.find(m => parseInt(m.numero) === mesaPlanoActiva);
    const cap = mesaObj ? (parseInt(mesaObj.capacidad) || 10) : 10;
    const ocupantes = listaComensalesGenerales.filter(c => c.mesa !== null && parseInt(c.mesa) === mesaPlanoActiva);
    abrirModalSentarEnMesa(mesaPlanoActiva, cap, ocupantes.length);
}

// DIBUJO DE MESA REDONDA
function dibujarMesaRedondaNormal(canvas, cap, ocupantes) {
    const centerTable = document.createElement('div');
    centerTable.className = 'table-center-circle';
    centerTable.innerHTML = `<strong style="font-family:'Playfair Display', serif; font-size:1.15rem;">Mesa ${mesaPlanoActiva}</strong><small class="text-muted" style="font-size:0.75rem;">${ocupantes.length} de ${cap} sillas</small>`;
    canvas.appendChild(centerTable);

    const radius = 175;
    for (let i = 1; i <= cap; i++) {
        const angle = (2 * Math.PI / cap) * (i - 1) - Math.PI / 2;
        const x = 220 + radius * Math.cos(angle) - 33;
        const y = 220 + radius * Math.sin(angle) - 33;

        const comensalEnSilla = ocupantes.find(c => parseInt(c.asiento_numero) === i);
        crearNodoSilla(canvas, i, x, y, comensalEnSilla, cap);
    }
}

// DIBUJO DE MESA RECTANGULAR DE LOS NOVIOS (CON CABECERAS)
function dibujarMesaRectangularNovios(canvas, cap, ocupantes) {
    const centerTable = document.createElement('div');
    centerTable.className = 'table-center-rect';
    centerTable.innerHTML = `<strong style="font-family:'Playfair Display', serif; font-size:1.15rem; color:#d4af37;">👑 Mesa 1: Novios</strong><small class="text-muted" style="font-size:0.75rem;">Mesa de Honor Rectangular</small>`;
    canvas.appendChild(centerTable);

    // Cabecera Izquierda (Silla 1)
    const comensalSilla1 = ocupantes.find(c => parseInt(c.asiento_numero) === 1);
    crearNodoSilla(canvas, 1, 20, 187, comensalSilla1, cap, "Cabecera 1");

    // Cabecera Derecha (Silla 2)
    const comensalSilla2 = ocupantes.find(c => parseInt(c.asiento_numero) === 2);
    crearNodoSilla(canvas, 2, 354, 187, comensalSilla2, cap, "Cabecera 2");

    // Distribución a los lados (Lado Superior e Inferior)
    const sillasLados = cap - 2;
    const sillasPorLado = Math.ceil(sillasLados / 2);
    
    const xInicio = 90;
    const xFin = 285;
    const pasoX = (xFin - xInicio) / Math.max(1, sillasPorLado - 1);

    let sillaNum = 3;
    // Lado Superior
    for (let s = 0; s < sillasPorLado && sillaNum <= cap; s++) {
        const x = xInicio + (s * pasoX);
        const y = 60;
        const comensal = ocupantes.find(c => parseInt(c.asiento_numero) === sillaNum);
        crearNodoSilla(canvas, sillaNum, x, y, comensal, cap);
        sillaNum++;
    }

    // Lado Inferior
    for (let s = 0; s < sillasPorLado && sillaNum <= cap; s++) {
        const x = xInicio + (s * pasoX);
        const y = 314;
        const comensal = ocupantes.find(c => parseInt(c.asiento_numero) === sillaNum);
        crearNodoSilla(canvas, sillaNum, x, y, comensal, cap);
        sillaNum++;
    }
}

function crearNodoSilla(canvas, numSilla, x, y, comensal, capTotal, etiquetaCustom = null) {
    const chair = document.createElement('div');
    chair.className = `seat-chair-node ${comensal ? 'is-occupied' : 'is-empty'}`;
    chair.style.left = `${x}px`;
    chair.style.top = `${y}px`;

    if (comensal) {
        const ladoClass = comensal.lado === 'Novia' ? 'lado-novia' : 'lado-novio';
        chair.classList.add(ladoClass);
        const torpedoEmoji = comensal.lado === 'Novia' ? '👰' : (comensal.lado === 'Ambos' ? '💍' : '🤵');
        
        chair.innerHTML = `<span>${torpedoEmoji}</span><strong class="text-truncate w-100 d-block" style="font-size:0.62rem;" title="${escapeHTML(comensal.nombre_mostrar)}">${escapeHTML(comensal.nombre_mostrar.split(' ')[0])}</strong>`;
        chair.title = `${comensal.nombre_mostrar} (Silla ${numSilla}) - Clic para quitar asiento`;
        chair.onclick = () => {
            if (confirm(`¿Quitar de la Silla ${numSilla} a ${comensal.nombre_mostrar}?`)) {
                desasignarSilla(comensal.id_drag);
            }
        };
    } else {
        chair.innerHTML = `<i class="bi bi-plus text-muted fs-6"></i><span style="font-size:0.65rem;">${etiquetaCustom || `Silla ${numSilla}`}</span>`;
        chair.title = `${etiquetaCustom || `Silla ${numSilla}`} Libre - Arrastra un comensal aquí o haz clic`;
        
        chair.ondragover = (ev) => { ev.preventDefault(); chair.classList.add('dragover-seat'); };
        chair.ondragleave = () => { chair.classList.remove('dragover-seat'); };
        chair.ondrop = (ev) => {
            ev.preventDefault();
            chair.classList.remove('dragover-seat');
            const idDrag = ev.dataTransfer.getData("text/plain");
            if (idDrag) asignarSillaEspecificaConPareja(idDrag, numSilla, capTotal);
        };

        chair.onclick = () => {
            const disponiblesEnMesa = listaComensalesGenerales.filter(c => c.mesa === mesaPlanoActiva && !c.asiento_numero);
            if (disponiblesEnMesa.length > 0) {
                const nombres = disponiblesEnMesa.map((c, idx) => `${idx + 1}. ${c.nombre_mostrar}`).join("\n");
                const resp = prompt(`Selecciona el número del comensal para sentar en la Silla ${numSilla}:\n\n${nombres}`);
                const idxElegido = parseInt(resp) - 1;
                if (!isNaN(idxElegido) && disponiblesEnMesa[idxElegido]) {
                    asignarSillaEspecificaConPareja(disponiblesEnMesa[idxElegido].id_drag, numSilla, capTotal);
                }
            } else {
                alert("Todos los comensales de esta mesa ya tienen asiento. Agrega comensales a la mesa primero.");
            }
        };
    }

    canvas.appendChild(chair);
}

function dragGuestPlano(ev, idDrag) {
    ev.stopPropagation();
    ev.dataTransfer.setData("text/plain", idDrag);
}

// ASIGNACIÓN DE SILLA ESPECÍFICA CON PAREJA A LA DERECHA O IZQUIERDA
function asignarSillaEspecificaConPareja(idDrag, numSilla, capTotal) {
    const comensal = listaComensalesGenerales.find(c => c.id_drag === idDrag);
    if (!comensal) return;

    guardarSnapshotUndo();
    comensal.asiento_numero = numSilla;

    // Si tiene pareja en esta mesa sin asiento asignado:
    const pareja = listaComensalesGenerales.find(c => c.nombre_principal === comensal.nombre_principal && c.es_pareja !== comensal.es_pareja && c.mesa === mesaPlanoActiva);
    
    if (pareja && !pareja.asiento_numero) {
        const sillasOcupadas = listaComensalesGenerales.filter(c => c.mesa === mesaPlanoActiva && c.asiento_numero).map(c => parseInt(c.asiento_numero));
        
        // Asignar silla adyacente (preferir derecha +1, sino izquierda -1)
        let sillaDerecha = (numSilla % capTotal) + 1;
        let sillaIzquierda = (numSilla - 1 <= 0) ? capTotal : (numSilla - 1);

        if (!sillasOcupadas.includes(sillaDerecha)) {
            pareja.asiento_numero = sillaDerecha;
        } else if (!sillasOcupadas.includes(sillaIzquierda)) {
            pareja.asiento_numero = sillaIzquierda;
        }
    }

    abrirModalPlanoMesa(mesaPlanoActiva);
    dibujarGridMesas();
    marcarCambioPendienteMesas();
}

function desasignarSilla(idDrag) {
    const comensal = listaComensalesGenerales.find(c => c.id_drag === idDrag);
    if (!comensal) return;

    guardarSnapshotUndo();
    comensal.asiento_numero = null;
    abrirModalPlanoMesa(mesaPlanoActiva);
    dibujarGridMesas();
    marcarCambioPendienteMesas();
}

// Auto-arranque al estar autenticado
if (sessionStorage.getItem('matri_unlocked')) {
    init();
}