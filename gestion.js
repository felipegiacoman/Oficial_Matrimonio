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
let autoSaveTimer = null;

// PILA DE DESHACER (CTRL + Z)
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

    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
        ejecutarGuardadoSilencioso();
    }, 2500);
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

// Foco automático en el buscador al abrir modal de sentar
document.addEventListener('DOMContentLoaded', () => {
    const modalSentar = document.getElementById('modalSentarEnMesa');
    if (modalSentar) {
        modalSentar.addEventListener('shown.bs.modal', function () {
            const input = document.getElementById('modal-buscar-sin-asignar');
            if (input) { input.value = ''; input.focus(); }
        });
    }
});

// ======================= LIMPIADOR UNIVERSAL INDESTRUCTIBLE =======================
// Esta función jamás arroja error aunque el dato sea null, undefined o número
function norm(str) {
    if (!str && str !== 0) return "";
    return String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function escapeHTML(str) { 
    return str ? String(str).replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag])) : ""; 
}

// ======================= COLA DE SINCRONIZACIÓN =======================
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
        const notas = (r[4] || '').trim();

        if (!nombre) continue;
        const siAsiste = asiste.includes('si') || asiste.includes('sí');
        if (!siAsiste) continue;

        const tienePareja = parejaVal === 'si' || parejaVal === 'sí';

        invitados.push({ nombre: nombre, es_pareja: false, nombre_principal: nombre });
        if (tienePareja) {
            let nombrePareja = `Pareja de ${nombre}`;
            if (notas && notas.split(/\s+/).length <= 4 && !notas.includes('.') && !notas.includes('!') && !notas.toLowerCase().includes('gracias') && !notas.toLowerCase().includes('aviso')) {
                nombrePareja = `${notas} (Pareja de ${nombre})`;
            }
            invitados.push({ nombre: nombrePareja, es_pareja: true, nombre_principal: nombre });
        }
    }
    return invitados;
}

async function cargarDatosFiesta() {
    try {
        let fetchUrl = `${SCRIPT_URL}?action=proxy_csv&url=${encodeURIComponent(GOOGLE_SHEET_FIESTA_CSV)}`;
        let res = await fetch(fetchUrl);
        if (!res.ok) throw new Error("No se pudo cargar");
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
    const el1 = document.getElementById('val-fiesta');
    const el2 = document.getElementById('tab-count-fiesta');
    const el3 = document.getElementById('fiesta-banquet-val');
    if (el1) el1.innerText = total;
    if (el2) el2.innerText = total;
    if (el3) el3.innerText = total;
}

function dibujarTablaFiesta() {
    const term = norm(document.getElementById('buscador-fiesta')?.value);
    let html = "";
    let idx = 1;

    listaInvitadosFiesta.forEach(f => {
        if (term === "" || norm(f.nombre).includes(term)) {
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

    const tabla = document.getElementById('tabla-fiesta');
    if (tabla) tabla.innerHTML = html || `<tr><td colspan="3" class="text-center text-muted py-4">No hay invitados de fiesta registrados.</td></tr>`;
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

// ======================= RECONCILIACIÓN DE MESAS HUÉRFANAS =======================
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
            if (cfg.worker_url) SCRIPT_URL = cfg.worker_url;
        }
    } catch(e) {}

    try {
        await cargarDatos();
        cargarDatosFiesta().catch(e => console.warn(e));
        actualizarBotonUndo();
    } catch(e) {
        console.error("Error en init:", e);
        if (relojEl) relojEl.innerHTML = `<span class="text-danger"><i class="bi bi-x-circle me-1"></i>Error: ${escapeHTML(e.message)}</span>`;
    }
}

async function cargarDatos() {
    const relojEl = document.getElementById('reloj-guardado');
    try {
        const [resM, resConf, resCanc, resMesas] = await Promise.all([
            fetch(`${SCRIPT_URL}?action=lista`).then(r => r.json()).catch(err => ({ error: err.message })),
            fetch(`${SCRIPT_URL}?action=confirmados`).then(r => r.json()).catch(err => ({ error: err.message })),
            fetch(`${SCRIPT_URL}?action=cancelados`).then(r => r.json()).catch(err => ({ error: err.message })),
            fetch(`${SCRIPT_URL}?action=mesas`).then(r => r.json()).catch(err => ({ error: err.message }))
        ]);

        if (resM.error || resConf.error || resCanc.error || resMesas.error) {
            const errDetalle = resM.error || resConf.error || resCanc.error || resMesas.error;
            console.error("Error devuelto por el servidor:", errDetalle);
            if (relojEl) relojEl.innerHTML = `<span class="text-danger"><i class="bi bi-exclamation-triangle-fill me-1"></i>${escapeHTML(errDetalle)}</span>`;
        }

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

        if (relojEl && !resM.error && !resConf.error) {
            relojEl.innerHTML = `<span class="text-success"><i class="bi bi-shield-check me-1"></i>Sistema conectado (${dataConfirmados.length} confirmados · ${dataMesas.length} mesas)</span>`;
        }
    } catch(e) { 
        console.error("Error fatal en cargarDatos:", e); 
        if (relojEl) relojEl.innerHTML = `<span class="text-danger"><i class="bi bi-wifi-off me-1"></i>Error interno: ${escapeHTML(e.message)}</span>`;
    }
}

function procesarDatosGenerales() {
    listaComensalesGenerales = []; 
    listaCancelables = []; 
    listaPendientes = [];
    listaDesglosadaMaestra = [];

    dataMaestra.forEach(m => {
        if (!m) return;
        const nombreTitular = m.nombre || 'Sin nombre';
        listaCancelables.push({ nombre_mostrar: nombreTitular, nombre_principal: nombreTitular, es_pareja: false });

        const conf = dataConfirmados.find(c => norm(c.nombre_invitado) === norm(nombreTitular));
        const estaConfirmado = !!conf;
        const titularCancelado = dataCancelados.some(c => norm(c.nombre) === norm(nombreTitular));

        let estadoTitular = 'Pendiente';
        if (estaConfirmado) estadoTitular = 'Confirmado';
        else if (titularCancelado) estadoTitular = 'Cancelado';

        const ladoInvitado = m.lado || 'Novio';

        listaDesglosadaMaestra.push({
            id_maestra: m.id,
            nombre: nombreTitular,
            nombre_principal: nombreTitular,
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
                : `Pareja de ${nombreTitular}`;

            const parejaCancelada = dataCancelados.some(c => {
                const cNom = norm(c.nombre);
                return cNom === norm(nombreParejaPotencial) || cNom === norm(`Pareja de ${nombreTitular}`);
            });

            let estadoPareja = 'Pendiente';
            if (parejaConfirmada) estadoPareja = 'Confirmado';
            else if (parejaCancelada) estadoPareja = 'Cancelado';

            listaDesglosadaMaestra.push({
                id_maestra: m.id,
                nombre: nombreParejaPotencial,
                nombre_principal: nombreTitular,
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
                    nombre_principal: nombreTitular,
                    lado: ladoInvitado,
                    es_pareja: true,
                    tiene_pareja_maestra: true
                });
            }
        }

        if (!estaConfirmado && !titularCancelado) {
            listaPendientes.push({
                nombre: nombreTitular,
                tipo: 'Titular',
                nombre_principal: nombreTitular,
                lado: ladoInvitado,
                es_pareja: false,
                tiene_pareja_maestra: parseInt(m.pareja) === 1
            });
        }
    });

    dataConfirmados.forEach(c => {
        if (!c) return;
        const nombreInv = c.nombre_invitado || 'Sin nombre';
        const infoMaestra = dataMaestra.find(m => norm(m.nombre) === norm(nombreInv));
        const esNinoTitular = infoMaestra ? (infoMaestra.nino === 1) : false;
        const ladoTitular = infoMaestra ? (infoMaestra.lado || 'Novio') : 'Novio';
        
        listaComensalesGenerales.push({
            id_drag: `prin_${nombreInv}`,
            nombre_mostrar: nombreInv,
            nombre_principal: nombreInv,
            es_pareja: false,
            mesa: (c.mesa_numero !== null && c.mesa_numero !== undefined && c.mesa_numero !== "") ? parseInt(c.mesa_numero) : null,
            dieta: c.dieta || 'Ninguna',
            esNino: esNinoTitular,
            lado: ladoTitular,
            telefono: c.telefono,
            lleva_pareja: c.lleva_pareja
        });

        if (c.lleva_pareja === "Sí") {
            let nombreP = (c.nombre_pareja && c.nombre_pareja !== "-" && c.nombre_pareja.toLowerCase() !== "pendiente") 
                ? `${c.nombre_pareja}` 
                : `Pareja de ${nombreInv}`;
                
            listaComensalesGenerales.push({
                id_drag: `par_${nombreInv}`,
                nombre_mostrar: nombreP,
                nombre_principal: nombreInv,
                es_pareja: true,
                mesa: (c.mesa_pareja !== null && c.mesa_pareja !== undefined && c.mesa_pareja !== "") ? parseInt(c.mesa_pareja) : null,
                dieta: c.dieta_pareja || 'Ninguna',
                esNino: false,
                lado: ladoTitular,
                telefono: "-"
            });
            listaCancelables.push({ nombre_mostrar: nombreP, nombre_principal: nombreInv, es_pareja: true });
        }
    });
}

// ======================= GUARDADO EN BBDD =======================
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
        mesa_numero: (c.mesa !== null && c.mesa !== undefined && c.mesa !== "") ? parseInt(c.mesa) : null
    }));

    return {
        tipo: "guardar_todo_mesas",
        mesas: mesasPayload,
        asignaciones: asignacionesPayload
    };
}

// ======================= MESAS (REORDENAMIENTO Y COMPACTACIÓN) =======================
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
    alert(`✅ Mesas renumeradas consecutivamente del 2 al ${dataMesas.length}.`);
}

function eliminarMesa(num) { 
    num = parseInt(num);
    if (num === 1) return alert("La Mesa 1 de los Novios no se puede eliminar.");
    if(!confirm(`¿Eliminar la Mesa ${num}? Sus comensales volverán a 'Por Asignar' y las mesas siguientes se compactarán automáticamente.`)) return; 

    guardarSnapshotUndo();
    reconciliarMesasHuerfanas();

    listaComensalesGenerales.forEach(c => { 
        if(parseInt(c.mesa) === num) c.mesa = null; 
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
    const el1 = document.getElementById('kpi-mesas-totales');
    const el2 = document.getElementById('kpi-sillas-ocupadas');
    const el3 = document.getElementById('kpi-sillas-totales');
    const el4 = document.getElementById('kpi-pct-ocupacion');
    const el5 = document.getElementById('kpi-sin-mesa');
    const el6 = document.getElementById('count-sin-asignar');

    if (el1) el1.innerText = dataMesas.length;
    if (el2) el2.innerText = sillasOcupadas;
    if (el3) el3.innerText = sillasTotales;
    if (el4) el4.innerText = `${pct}%`;
    if (el5) el5.innerText = sinAsignar.length;
    if (el6) el6.innerText = sinAsignar.length;
}

function filtrarSinAsignarLado(lado) {
    filtroSinAsignarLado = lado;
    document.querySelectorAll('[id^="btn-sin-filtro-"]').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById(`btn-sin-filtro-${lado.toLowerCase()}`);
    if (btn) btn.classList.add('active');
    dibujarListaSinAsignar();
}

function dibujarListaSinAsignar() {
    const sinAsignar = listaComensalesGenerales.filter(c => c.mesa === null || c.mesa === "");
    const term = norm(document.getElementById('buscador-por-asignar')?.value);
    
    let html = "";
    sinAsignar.forEach(c => {
        const matchLado = (filtroSinAsignarLado === 'todos') || (c.lado === filtroSinAsignarLado) || (c.lado === 'Ambos');
        const matchSearch = term === "" || norm(c.nombre_mostrar).includes(term);

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
    const listaEl = document.getElementById('lista-sin-asignar');
    if (listaEl) listaEl.innerHTML = html || `<p class="text-muted small mt-2 text-center">Todos tienen mesa asignada.</p>`;
}

function filtrarPorAsignar() { dibujarListaSinAsignar(); }

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

            htmlOcupantes += `
            <div class="guest-item draggable-guest" draggable="true" ondragstart="dragGuest(event, '${c.id_drag}')">
                <div class="d-flex align-items-center text-truncate me-2">
                    <span class="torpedo-badge ${torpedoClass}" title="Lado: ${c.lado}">${torpedoEmoji}</span>
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
                        <i class="bi bi-aspect-ratio action-icon ms-1" title="Ver Distribución de Asientos en Círculo" onclick="abrirModalPlanoMesa(${num})"></i>
                        <i class="bi bi-people action-icon" title="Cambiar Sillas" onclick="cambiarCapacidad(${num}, ${cap})"></i>
                        <i class="bi bi-pencil-square action-icon" title="Renombrar Alias" onclick="editarAliasMesa(${num})"></i>
                        ${!esMesaNovios ? `<i class="bi bi-123 action-icon" title="Cambiar Número de Mesa" onclick="cambiarNumero(${num})"></i>` : ''}
                        ${!esMesaNovios ? `<i class="bi bi-trash action-icon trash-icon" title="Eliminar Mesa" onclick="eliminarMesa(${num})"></i>` : ''}
                    </div>
                    <span class="badge ${estaLlena ? 'bg-danger' : 'bg-success'}">${cant} / ${cap}</span>
                </div>

                <div class="drop-zone mb-2" style="max-height: 250px; overflow-y: auto;" ondragover="allowDropGuest(event)" ondragleave="leaveDropGuest(event)" ondrop="dropGuest(event, ${num}, ${cap}, ${cant})">
                    ${htmlOcupantes || '<div class="text-muted small mt-2 text-center">Mesa vacía</div>'}
                </div>

                <button class="btn btn-outline-primary btn-sm w-100 py-1 mb-1 fw-semibold" style="font-size:0.75rem;" onclick="abrirModalPlanoMesa(${num})">
                    <i class="bi bi-diagram-3 me-1"></i>Ver / Organizar Asientos
                </button>

                <button class="btn btn-outline-dark btn-sm w-100 py-1" style="font-size:0.75rem;" onclick="abrirModalSentarEnMesa(${num}, ${cap}, ${cant})" ${estaLlena ? 'disabled' : ''}>
                    ${estaLlena ? 'Mesa Completa' : '+ Sentar comensal'}
                </button>
            </div>
        </div>`;
    });

    const cont = document.getElementById('contenedor-mesas');
    if (cont) cont.innerHTML = htmlGrid || `<div class="col-12 text-center text-muted py-4">No hay mesas en esta categoría.</div>`;
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

function intentarAsignar(idDrag, mesaNum, capMax, capActual, autoPareja = true) {
    if(!idDrag) return; 
    const comensal = listaComensalesGenerales.find(c => c.id_drag === idDrag); 
    if (!comensal) return;
    
    if (mesaNum !== null && comensal.mesa !== null && parseInt(comensal.mesa) === parseInt(mesaNum)) return;

    guardarSnapshotUndo();

    if (mesaNum === null) {
        comensal.mesa = null;
        dibujarPanelMesas();
        dibujarPanelBanqueteria();
        marcarCambioPendienteMesas();
        return;
    }

    let companero = null;
    if (autoPareja) {
        if (comensal.es_pareja) {
            companero = listaComensalesGenerales.find(c => norm(c.nombre_principal) === norm(comensal.nombre_principal) && !c.es_pareja && (c.mesa === null || c.mesa === ""));
        } else {
            companero = listaComensalesGenerales.find(c => norm(c.nombre_principal) === norm(comensal.nombre_principal) && c.es_pareja && (c.mesa === null || c.mesa === ""));
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
            if (confirm(`La Mesa ${mesaNum} solo tiene 1 asiento disponible.\n¿Deseas sentar solo a ${comensal.nombre_mostrar} sin su pareja?`)) {
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
    const cap = document.getElementById('nueva-mesa-cap').value;
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
    const term = norm(val);
    document.querySelectorAll('.mesa-card').forEach(card => card.classList.remove('highlight-mesa'));
    if(term.length < 2) return;

    const comensal = listaComensalesGenerales.find(c => c.mesa !== null && norm(c.nombre_mostrar).includes(term));
    let mesaObjetivo = comensal ? parseInt(comensal.mesa) : null;

    if (!mesaObjetivo) {
        const mesa = dataMesas.find(m => {
            const aliasMatch = m.alias && norm(m.alias).includes(term);
            const numMatch = `mesa ${m.numero}`.includes(term) || (term === String(m.numero));
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
    const b = document.getElementById(`filtro-mesa-${tipo}`);
    if (b) b.classList.add('active');
    dibujarGridMesas();
}

// ======================= MODAL SENTAR 1-CLIC =======================
function abrirModalAsignarDirecto(idDrag, mesaActual = null) {
    const comensal = listaComensalesGenerales.find(c => c.id_drag === idDrag);
    if(!comensal) return;
    comensalModalActivo = comensal;

    document.getElementById('modalMoverMesaTitulo').innerText = `Asignar a: ${comensal.nombre_mostrar}`;
    document.getElementById('modalMoverMesaSubtitulo').innerText = mesaActual !== null 
        ? `Actualmente en Mesa ${mesaActual}.` : `Aún no tiene mesa asignada.`;

    const select = document.getElementById('select-destino-mesa');
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
    const selectVal = document.getElementById('select-destino-mesa').value;
    bootstrap.Modal.getInstance(document.getElementById('modalMoverMesa')).hide();

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
    
    document.getElementById('modalSentarMesaTitulo').innerText = (numMesa === 1) ? `Sentar en Mesa 1 (Los Novios)` : `Sentar en Mesa ${numMesa}`;
    renderListaModalSinAsignar(candidatosSinMesaGlobal);
    new bootstrap.Modal(document.getElementById('modalSentarEnMesa')).show();
}

function renderListaModalSinAsignar(lista) {
    const cont = document.getElementById('modal-lista-candidatos');
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
    const term = norm(val);
    renderListaModalSinAsignar(candidatosSinMesaGlobal.filter(c => norm(c.nombre_mostrar).includes(term)));
}

function ejecutarSentarDesdeModal(idDrag) {
    if(!mesaModalActiva) return;
    bootstrap.Modal.getInstance(document.getElementById('modalSentarEnMesa')).hide();
    intentarAsignar(idDrag, mesaModalActiva.num, mesaModalActiva.capMax, mesaModalActiva.capActual);
}

// ======================= PLANO GRÁFICO CIRCULAR =======================
function abrirModalPlanoMesa(numMesa) {
    mesaPlanoActiva = numMesa;
    const mesaObj = dataMesas.find(m => parseInt(m.numero) === parseInt(numMesa));
    if (!mesaObj) return;

    const cap = parseInt(mesaObj.capacidad) || 10;
    const ocupantes = listaComensalesGenerales.filter(c => c.mesa !== null && parseInt(c.mesa) === parseInt(numMesa));
    const esNovios = (parseInt(numMesa) === 1);

    document.getElementById('modalPlanoMesaTitulo').innerText = esNovios ? `👑 Mesa 1 (Los Novios) - Plano de Asientos` : `Mesa ${numMesa} (${mesaObj.alias || 'Sin alias'}) - Plano de Asientos`;
    document.getElementById('modal-plano-count').innerText = `${ocupantes.length}/${cap}`;

    let htmlLista = "";
    ocupantes.forEach((c) => {
        const torpedoClass = c.lado === 'Novia' ? 'torpedo-novia' : (c.lado === 'Ambos' ? 'torpedo-ambos' : 'torpedo-novio');
        const torpedoEmoji = c.lado === 'Novia' ? '👰' : (c.lado === 'Ambos' ? '💍' : '🤵');
        htmlLista += `
        <div class="list-group-item d-flex justify-content-between align-items-center p-2">
            <div class="d-flex align-items-center text-truncate me-2">
                <span class="torpedo-badge ${torpedoClass}">${torpedoEmoji}</span>
                <span class="small fw-semibold text-truncate">${escapeHTML(c.nombre_mostrar)}</span>
            </div>
            <button class="btn btn-sm btn-outline-danger py-0 px-1" title="Quitar de la mesa" onclick="intentarAsignar('${c.id_drag}', null, null, null); abrirModalPlanoMesa(${numMesa});"><i class="bi bi-x"></i></button>
        </div>`;
    });
    document.getElementById('modal-plano-lista-comensales').innerHTML = htmlLista || `<div class="p-3 text-muted small text-center">Mesa sin comensales.</div>`;

    const wrapper = document.getElementById('modal-plano-circulo-grafico');
    wrapper.innerHTML = "";

    const centerCircle = document.createElement('div');
    centerCircle.className = "circle-table-center";
    centerCircle.innerHTML = `<strong style="font-family:'Playfair Display', serif; font-size:1.1rem;">${esNovios ? '👑 Novios' : `Mesa ${numMesa}`}</strong><small class="text-muted" style="font-size:0.7rem;">${cap} sillas</small>`;
    wrapper.appendChild(centerCircle);

    const radius = 135;
    for (let i = 0; i < cap; i++) {
        const angle = (2 * Math.PI / cap) * i - Math.PI / 2;
        const x = 170 + radius * Math.cos(angle) - 34;
        const y = 170 + radius * Math.sin(angle) - 34;

        const comensalSilla = ocupantes[i];
        const chair = document.createElement('div');
        chair.className = `chair-pod-node ${comensalSilla ? '' : 'is-empty'}`;
        chair.style.left = `${x}px`;
        chair.style.top = `${y}px`;

        if (comensalSilla) {
            const torpedoEmoji = comensalSilla.lado === 'Novia' ? '👰' : (comensalSilla.lado === 'Ambos' ? '💍' : '🤵');
            chair.innerHTML = `<span>${torpedoEmoji}</span><span class="text-truncate d-block w-100 fw-bold" style="font-size:0.65rem;">${escapeHTML(comensalSilla.nombre_mostrar.split(' ')[0])}</span>`;
            chair.title = `${comensalSilla.nombre_mostrar} (Clic para quitar)`;
            chair.onclick = () => {
                if (confirm(`¿Quitar a ${comensalSilla.nombre_mostrar} de la mesa?`)) {
                    intentarAsignar(comensalSilla.id_drag, null, null, null);
                    abrirModalPlanoMesa(numMesa);
                }
            };
        } else {
            chair.innerHTML = `<i class="bi bi-plus-circle text-muted"></i><span style="font-size:0.65rem;">Silla ${i+1}</span>`;
            chair.title = `Silla ${i+1} Libre (Clic para sentar)`;
            chair.onclick = () => {
                abrirModalSentarEnMesa(numMesa, cap, ocupantes.length);
            };
        }
        wrapper.appendChild(chair);
    }

    new bootstrap.Modal(document.getElementById('modalPlanoMesa')).show();
}

// ======================= CONFIRMAR PENDIENTE CON FLUJO DE PAREJA =======================
function confirmarDesdePendientes(nombrePrincipal, esPareja, nombreMostrar) {
    if (esPareja) {
        if (!confirm(`¿Confirmar a ${nombreMostrar}?`)) return;
        ejecutarConfirmacionAccion(nombrePrincipal, true, 'confirmar_pareja');
        return;
    }

    const tieneParejaMaestra = dataMaestra.some(m => norm(m.nombre) === norm(nombrePrincipal) && parseInt(m.pareja) === 1);

    if (!tieneParejaMaestra) {
        if (!confirm(`¿Confirmar asistencia de ${nombrePrincipal}?`)) return;
        ejecutarConfirmacionAccion(nombrePrincipal, false, 'confirmar_titular_solo');
        return;
    }

    const modalCuerpo = document.getElementById('modalConfirmarCuerpo');
    document.getElementById('modalConfirmarTitulo').innerText = `Confirmar: ${nombrePrincipal}`;
    
    modalCuerpo.innerHTML = `
    <p class="small mb-3">El invitado <strong>${escapeHTML(nombrePrincipal)}</strong> contempla acompañante (+1). ¿Cómo deseas confirmar?</p>
    <div class="d-grid gap-2">
        <button class="btn btn-success py-2 fw-semibold text-start" onclick="ejecutarConfirmacionAccion('${escapeHTML(nombrePrincipal)}', false, 'ambos')">
            <i class="bi bi-people-fill me-2"></i> Confirmar a AMBOS (Titular y Pareja)
        </button>
        <button class="btn btn-outline-primary py-2 fw-semibold text-start" onclick="mostrarPasoDosParejaPendiente('${escapeHTML(nombrePrincipal)}')">
            <i class="bi bi-person-fill me-2"></i> Confirmar SOLO al Titular
        </button>
    </div>`;

    new bootstrap.Modal(document.getElementById('modalConfirmarPendientePareja')).show();
}

function mostrarPasoDosParejaPendiente(nombrePrincipal) {
    const modalCuerpo = document.getElementById('modalConfirmarCuerpo');
    modalCuerpo.innerHTML = `
    <p class="small mb-3">Se confirmará solo a <strong>${escapeHTML(nombrePrincipal)}</strong>. ¿Qué debe ocurrir con el cupo de su pareja?</p>
    <div class="d-grid gap-2">
        <button class="btn btn-outline-warning text-dark py-2 fw-semibold text-start" onclick="ejecutarConfirmacionAccion('${escapeHTML(nombrePrincipal)}', false, 'solo_titular_pareja_pendiente')">
            <i class="bi bi-clock-history me-2"></i> Dejar a la pareja en PENDIENTES (por confirmar)
        </button>
        <button class="btn btn-outline-danger py-2 fw-semibold text-start" onclick="ejecutarConfirmacionAccion('${escapeHTML(nombrePrincipal)}', false, 'solo_titular_pareja_cancelada')">
            <i class="bi bi-x-circle-fill me-2"></i> Mover a la pareja a CANCELADOS (no asistirá)
        </button>
    </div>`;
}

function ejecutarConfirmacionAccion(nombrePrincipal, esPareja, opcion) {
    const modalInstance = bootstrap.Modal.getInstance(document.getElementById('modalConfirmarPendientePareja'));
    if (modalInstance) modalInstance.hide();

    let conf = dataConfirmados.find(c => norm(c.nombre_invitado) === norm(nombrePrincipal));

    if (opcion === 'ambos') {
        if (!conf) {
            dataConfirmados.push({ nombre_invitado: nombrePrincipal, lleva_pareja: "Sí", nombre_pareja: `Pareja de ${nombrePrincipal}`, telefono: "-", dieta: "Ninguna", dieta_pareja: "Ninguna", mesa_numero: null });
        } else {
            conf.lleva_pareja = "Sí";
            conf.dieta = "Ninguna";
            if (!conf.nombre_pareja || conf.nombre_pareja === "-") conf.nombre_pareja = `Pareja de ${nombrePrincipal}`;
        }
        dataCancelados = dataCancelados.filter(c => {
            const cNom = norm(c.nombre);
            return cNom !== norm(nombrePrincipal) && cNom !== norm(`Pareja de ${nombrePrincipal}`);
        });
        addToQueue({ tipo: "admin_confirmar", nombre_principal: nombrePrincipal, es_pareja: false });
        addToQueue({ tipo: "admin_confirmar", nombre_principal: nombrePrincipal, es_pareja: true });
    }
    else if (opcion === 'solo_titular_pareja_pendiente') {
        if (!conf) {
            dataConfirmados.push({ nombre_invitado: nombrePrincipal, lleva_pareja: "No", telefono: "-", dieta: "Ninguna", mesa_numero: null });
        } else {
            conf.lleva_pareja = "No";
            conf.dieta = "Ninguna";
        }
        dataCancelados = dataCancelados.filter(c => norm(c.nombre) !== norm(nombrePrincipal));
        addToQueue({ tipo: "admin_confirmar", nombre_principal: nombrePrincipal, es_pareja: false });
    }
    else if (opcion === 'solo_titular_pareja_cancelada') {
        if (!conf) {
            dataConfirmados.push({ nombre_invitado: nombrePrincipal, lleva_pareja: "No", telefono: "-", dieta: "Ninguna", mesa_numero: null });
        } else {
            conf.lleva_pareja = "No";
            conf.dieta = "Ninguna";
        }
        dataCancelados = dataCancelados.filter(c => norm(c.nombre) !== norm(nombrePrincipal));
        dataCancelados.push({ nombre: `Pareja de ${nombrePrincipal}`, mensaje: "Cancelada por decisión del titular" });
        addToQueue({ tipo: "admin_confirmar", nombre_principal: nombrePrincipal, es_pareja: false });
        addToQueue({ tipo: "admin_cancelar", nombre_principal: nombrePrincipal, es_pareja: true });
    }
    else if (opcion === 'confirmar_titular_solo') {
        if (!conf) {
            dataConfirmados.push({ nombre_invitado: nombrePrincipal, lleva_pareja: "No", telefono: "-", dieta: "Ninguna", mesa_numero: null });
        } else {
            conf.dieta = "Ninguna";
        }
        dataCancelados = dataCancelados.filter(c => norm(c.nombre) !== norm(nombrePrincipal));
        addToQueue({ tipo: "admin_confirmar", nombre_principal: nombrePrincipal, es_pareja: false });
    }
    else if (opcion === 'confirmar_pareja') {
        if (conf) {
            conf.lleva_pareja = "Sí";
            conf.dieta_pareja = "Ninguna";
        } else {
            dataConfirmados.push({ nombre_invitado: nombrePrincipal, lleva_pareja: "Sí", nombre_pareja: `Pareja de ${nombrePrincipal}`, telefono: "-", dieta: "Ninguna", dieta_pareja: "Ninguna", mesa_numero: null });
        }
        dataCancelados = dataCancelados.filter(c => norm(c.nombre) !== norm(`Pareja de ${nombrePrincipal}`));
        addToQueue({ tipo: "admin_confirmar", nombre_principal: nombrePrincipal, es_pareja: true });
    }

    procesarDatosGenerales();
    dibujarPanelConfirmaciones();
    dibujarPanelBanqueteria();
    dibujarPanelMesas();
    dibujarTablaListaMaestra();
}

function cancelarDesdePendientes(nombrePrincipal, esPareja) {
    let msg = esPareja ? `¿Bajar a la pareja de ${nombrePrincipal}?` : `¿Bajar al titular ${nombrePrincipal}?`;
    if(!confirm(msg)) return;
    
    if(!esPareja) {
        dataCancelados.push({ nombre: nombrePrincipal, mensaje: "Dado de baja" });
        const ms = dataMaestra.find(m => norm(m.nombre) === norm(nombrePrincipal));
        if(ms && parseInt(ms.pareja) === 1) dataCancelados.push({ nombre: `Pareja de ${nombrePrincipal}`, mensaje: "Titular dado de baja" });
    } else {
        dataCancelados.push({ nombre: `Pareja de ${nombrePrincipal}`, mensaje: "Dado de baja" });
    }
    
    procesarDatosGenerales(); 
    dibujarPanelConfirmaciones(); 
    dibujarTablaListaMaestra();
    addToQueue({ tipo: "admin_cancelar", nombre_principal: nombrePrincipal, es_pareja: esPareja });
}

// ======================= CONFIRMACIONES CON FILTRO GLOBAL =======================
function filtrarConfirmacionesLado(lado) {
    filtroConfirmacionesLadoActual = lado;
    document.querySelectorAll('[id^="btn-conf-filtro-"]').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById(`btn-conf-filtro-${lado.toLowerCase()}`);
    if (btn) btn.classList.add('active');
    dibujarPanelConfirmaciones();
}

function dibujarPanelConfirmaciones() {
    const term = norm(document.getElementById('buscador-confirmados')?.value);
    const termPend = norm(document.getElementById('buscador-pendientes')?.value);

    // Filtrar comensales según botón global Novio/Novia
    const confirmadosFiltrados = listaComensalesGenerales.filter(c => {
        if (filtroConfirmacionesLadoActual === 'todos') return true;
        return c.lado === filtroConfirmacionesLadoActual || c.lado === 'Ambos';
    });

    const pendientesFiltrados = listaPendientes.filter(p => {
        if (filtroConfirmacionesLadoActual === 'todos') return true;
        return p.lado === filtroConfirmacionesLadoActual || p.lado === 'Ambos';
    });

    const canceladosFiltrados = dataCancelados.filter(c => {
        if (filtroConfirmacionesLadoActual === 'todos') return true;
        const titularNombre = String(c.nombre || '').replace('Pareja de ', '').trim();
        const m = dataMaestra.find(item => norm(item.nombre) === norm(titularNombre));
        return m ? (m.lado === filtroConfirmacionesLadoActual || m.lado === 'Ambos') : true;
    });

    document.getElementById('val-confirmados').innerText = confirmadosFiltrados.length;
    document.getElementById('val-pendientes').innerText = pendientesFiltrados.length;
    document.getElementById('val-cancelados').innerText = canceladosFiltrados.length;

    // Tabla Confirmados
    let htmlConf = "";
    confirmadosFiltrados.forEach(c => {
        if (term === "" || norm(c.nombre_mostrar).includes(term)) {
            const btnBajar = `<button class="btn btn-sm btn-outline-danger py-0 px-2 me-1" title="Bajar a Cancelados" onclick="bajarDesdeConfirmados('${c.id_drag}')"><i class="bi bi-x-circle"></i> Bajar</button>`;
            const btnMasPareja = (!c.es_pareja && c.lleva_pareja !== 'Sí') 
                ? `<button class="btn btn-sm btn-outline-primary py-0 px-2" title="Agregar acompañante" onclick="agregarParejaAConfirmado('${escapeHTML(c.nombre_principal)}')"><i class="bi bi-person-plus"></i> + Pareja</button>` 
                : '';

            htmlConf += `<tr ${c.es_pareja ? 'style="background-color: #fdfbf7;"' : ''}>
                <td style="white-space: nowrap;">${btnBajar}${btnMasPareja}</td>
                <td class="${c.es_pareja ? 'ps-4' : ''}">${c.es_pareja ? '↳ ' : ''}<strong>${escapeHTML(c.nombre_mostrar)}</strong></td>
                <td><span class="badge ${c.es_pareja ? 'bg-secondary' : 'bg-primary'}">${c.es_pareja ? 'Pareja' : 'Titular'}</span></td>
                <td>${escapeHTML(c.telefono || '-')}</td>
                <td>${escapeHTML(c.dieta)}</td>
            </tr>`;
        }
    });
    const tConf = document.getElementById('tabla-confirmados');
    if (tConf) tConf.innerHTML = htmlConf || `<tr><td colspan="5" class="text-center text-muted">No hay resultados.</td></tr>`;

    // Tabla Pendientes
    let htmlPend = "";
    pendientesFiltrados.forEach(p => {
        if (termPend === "" || norm(p.nombre).includes(termPend)) {
            const btnConfirmar = `<button class="btn btn-sm btn-outline-success py-0 px-2 me-1" title="Confirmar asistencia" onclick="confirmarDesdePendientes('${escapeHTML(p.nombre_principal)}', ${p.es_pareja}, '${escapeHTML(p.nombre)}')"><i class="bi bi-check-lg"></i></button>`;
            const btnBajar = `<button class="btn btn-sm btn-outline-danger py-0 px-2 me-1" title="Bajar a Cancelados" onclick="cancelarDesdePendientes('${escapeHTML(p.nombre_principal)}', ${p.es_pareja})"><i class="bi bi-x-circle"></i></button>`;
            
            const titularTieneParejaActiva = listaPendientes.some(x => norm(x.nombre_principal) === norm(p.nombre_principal) && x.es_pareja) || 
                                             dataConfirmados.some(c => norm(c.nombre_invitado) === norm(p.nombre_principal) && c.lleva_pareja === 'Sí');
            
            const btnHabilitarPareja = (!p.es_pareja && !titularTieneParejaActiva) 
                ? `<button class="btn btn-sm btn-outline-primary py-0 px-2" title="Habilitar Pareja (+1)" onclick="agregarParejaAPendiente('${escapeHTML(p.nombre_principal)}')"><i class="bi bi-person-plus"></i> + Pareja</button>` 
                : '';

            htmlPend += `<tr ${p.tipo === 'Pareja' ? 'style="background-color: #fdfbf7;"' : ''}>
                <td style="white-space: nowrap;">${btnConfirmar}${btnBajar}${btnHabilitarPareja}</td>
                <td class="${p.tipo === 'Pareja' ? 'ps-4' : ''}">${p.tipo === 'Pareja' ? '↳ ' : ''}<strong>${escapeHTML(p.nombre)}</strong></td>
                <td><span class="badge ${p.tipo === 'Pareja' ? 'bg-secondary' : 'bg-warning text-dark'}">${p.tipo}</span></td>
            </tr>`;
        }
    });
    const tPend = document.getElementById('tabla-pendientes');
    if (tPend) tPend.innerHTML = htmlPend || `<tr><td colspan="3" class="text-center text-muted">No hay resultados.</td></tr>`;

    // Tabla Cancelados
    let htmlCanc = "";
    canceladosFiltrados.forEach(c => {
        htmlCanc += `<tr><td><strong>${escapeHTML(c.nombre)}</strong></td><td><span class="text-muted small">${escapeHTML(c.mensaje || '-')}</span></td></tr>`;
    });
    const tCanc = document.getElementById('tabla-cancelados');
    if (tCanc) tCanc.innerHTML = htmlCanc || `<tr><td colspan="2" class="text-center text-muted">No hay resultados.</td></tr>`;
}

function bajarDesdeConfirmados(idDrag) {
    const comensal = listaComensalesGenerales.find(c => c.id_drag === idDrag);
    if (!comensal) return;

    if (comensal.es_pareja) {
        if (!confirm(`¿Dar de baja a la pareja ${comensal.nombre_mostrar}?`)) return;
        const conf = dataConfirmados.find(c => norm(c.nombre_invitado) === norm(comensal.nombre_principal));
        if (conf) { conf.lleva_pareja = 'No'; conf.nombre_pareja = '-'; conf.dieta_pareja = '-'; conf.mesa_pareja = null; }
        dataCancelados.push({ nombre: comensal.nombre_mostrar, mensaje: 'Cancelada manualmente' });
        addToQueue({ tipo: "admin_cancelar", nombre_principal: comensal.nombre_principal, es_pareja: true });
    } else {
        const conf = dataConfirmados.find(c => norm(c.nombre_invitado) === norm(comensal.nombre_principal));
        const tienePareja = conf && conf.lleva_pareja === 'Sí';
        let advertencia = `¿Dar de baja a ${comensal.nombre_mostrar}?`;
        if (tienePareja) advertencia += `\nSu pareja registrada (${conf.nombre_pareja || 'Pareja'}) también será dada de baja.`;
        if (!confirm(advertencia)) return;

        dataConfirmados = dataConfirmados.filter(c => norm(c.nombre_invitado) !== norm(comensal.nombre_principal));
        dataCancelados.push({ nombre: comensal.nombre_mostrar, mensaje: 'Cancelado manualmente' });
        if (tienePareja) {
            let nPareja = (conf.nombre_pareja && conf.nombre_pareja !== '-' && conf.nombre_pareja.toLowerCase() !== 'pendiente') ? conf.nombre_pareja : `Pareja de ${comensal.nombre_principal}`;
            dataCancelados.push({ nombre: nPareja, mensaje: 'Cancelado junto al titular' });
        }
        addToQueue({ tipo: "admin_cancelar", nombre_principal: comensal.nombre_principal, es_pareja: false });
    }

    procesarDatosGenerales(); dibujarPanelConfirmaciones(); dibujarPanelBanqueteria(); dibujarPanelMesas(); dibujarTablaListaMaestra();
}

function agregarParejaAConfirmado(nombrePrincipal) {
    const conf = dataConfirmados.find(c => norm(c.nombre_invitado) === norm(nombrePrincipal));
    if (!conf) return;

    const nombreP = prompt(`Nombre de la pareja para ${nombrePrincipal}:\n(Deja en blanco para 'Pareja de ${nombrePrincipal}')`);
    if (nombreP === null) return;
    const dietaP = prompt(`Restricción alimentaria de la pareja (opcional):`);
    if (dietaP === null) return;

    const nombreFinal = nombreP.trim() !== "" ? nombreP.trim() : `Pareja de ${nombrePrincipal}`;
 