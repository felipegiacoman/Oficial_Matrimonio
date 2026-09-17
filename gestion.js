const WORKER_URL_DEFAULT = "https://rsvp-api.felipegiacoman.workers.dev";
let SCRIPT_URL = WORKER_URL_DEFAULT;

// LINK DE GOOGLE SHEETS EN DURO
const CSV_FIESTA_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSS80lahmhX6xknc-Y9y4M8n2vL8iEbf7VMSQqC1U1HlaYhmA0IpEZBgEGvG9wr8t2jBFmbxttEzYjT/pub?output=csv";

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

let filtroActualBanqueteria = 'Todas';
let filtroMesasEstado = 'todas';
let filtroLadoMaestraActual = 'todos';
let filtroConfirmacionesLadoActual = 'todos';
let filtroTrayPorAsignarActual = 'todos';

// ======================= HISTORIAL UNDO / CTRL+Z =======================
let historialMesas = [];

function guardarEstadoHistorial() {
    const estado = {
        mesas: JSON.parse(JSON.stringify(dataMesas)),
        asignaciones: listaComensalesGenerales.map(c => ({ id_drag: c.id_drag, mesa: c.mesa }))
    };
    historialMesas.push(estado);
    if (historialMesas.length > 25) historialMesas.shift();
    actualizarBotonUndo();
}

function deshacerCambioMesa() {
    if (historialMesas.length === 0) return;
    const anterior = historialMesas.pop();
    
    dataMesas = anterior.mesas;
    anterior.asignaciones.forEach(item => {
        const c = listaComensalesGenerales.find(x => x.id_drag === item.id_drag);
        if (c) c.mesa = item.mesa;
    });

    actualizarBotonUndo();
    dibujarPanelMesas();
    dibujarPanelBanqueteria();
    marcarCambioPendienteMesas();
}

function actualizarBotonUndo() {
    const btn = document.getElementById('btn-undo-mesa');
    if (btn) btn.disabled = (historialMesas.length === 0);
}

window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        const panelMesas = document.getElementById('panel-mesas');
        if (panelMesas && panelMesas.classList.contains('active')) {
            e.preventDefault();
            deshacerCambioMesa();
        }
    }
});

// ======================= CONTROL DE GUARDADO =======================
let hayCambiosMesas = false;
let autoSaveTimer = null;

function marcarCambioPendienteMesas() {
    hayCambiosMesas = true;
    const btn = document.getElementById('btn-guardar-cambios-mesas');
    const btnTexto = document.getElementById('btn-guardar-texto');
    if (btn) btn.className = "btn btn-warning btn-sm fw-bold px-3 py-2 shadow-sm";
    if (btnTexto) btnTexto.innerHTML = `Guardar Cambios <span class="badge bg-danger ms-1">●</span>`;

    // Auto-guardado en segundo plano tras 2 segundos
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
        ejecutarGuardadoSilencioso();
    }, 2000);
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

function quitarTildes(str) { return str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : ""; }
function escapeHTML(str) { return str ? str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag])) : ""; }

// ======================= FIESTA =======================
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
    const statusEl = document.getElementById('status-sheet-sync');
    try {
        let fetchUrl = `${SCRIPT_URL}?action=proxy_csv&url=${encodeURIComponent(CSV_FIESTA_URL)}`;
        let res = await fetch(fetchUrl);
        if (!res.ok) throw new Error();
        let text = await res.text();
        
        if (text && text.length > 20) {
            localStorage.setItem('cacheFiestaCSV', text);
            listaInvitadosFiesta = procesarTextoCSVFiesta(text);
            if (statusEl) statusEl.innerHTML = `<span class="text-success"><i class="bi bi-check-circle me-1"></i>Sincronizado con Google Sheets automáticamente (${listaInvitadosFiesta.length} comensales)</span>`;
        }
    } catch (e) {
        let cached = localStorage.getItem('cacheFiestaCSV');
        if (cached) {
            listaInvitadosFiesta = procesarTextoCSVFiesta(cached);
            if (statusEl) statusEl.innerHTML = `<span class="text-muted"><i class="bi bi-info-circle me-1"></i>Mostrando copia guardada (${listaInvitadosFiesta.length} comensales)</span>`;
        }
    }
    actualizarContadoresFiesta();
    dibujarTablaFiesta();
}

function actualizarContadoresFiesta() {
    const total = listaInvitadosFiesta.length;
    document.getElementById('val-fiesta').innerText = total;
    document.getElementById('tab-count-fiesta').innerText = total;
    document.getElementById('fiesta-banquet-val').innerText = total;
}

function dibujarTablaFiesta() {
    const term = quitarTildes((document.getElementById('buscador-fiesta')?.value || '').toLowerCase().trim());
    let html = "";
    let idx = 1;

    listaInvitadosFiesta.forEach(f => {
        if (term === "" || quitarTildes(f.nombre.toLowerCase()).includes(term)) {
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

    document.getElementById('tabla-fiesta').innerHTML = html || `<tr><td colspan="3" class="text-center text-muted py-4">No hay invitados de fiesta registrados.</td></tr>`;
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

// ======================= RECONCILIACIÓN Y CARGA =======================
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
    if (huboRescate) marcarCambioPendienteMesas();
}

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

        // Migrar mesa 0 histórica a Mesa 1
        const mesaCero = dataMesas.find(m => parseInt(m.numero) === 0);
        if (mesaCero) {
            dataConfirmados.forEach(c => {
                if (parseInt(c.mesa_numero) === 0) c.mesa_numero = 1;
                if (parseInt(c.mesa_pareja) === 0) c.mesa_pareja = 1;
            });
            const mesaUno = dataMesas.find(m => parseInt(m.numero) === 1);
            if (mesaUno) mesaUno.alias = mesaCero.alias || "Mesa de los Novios";
            else { mesaCero.numero = 1; mesaCero.alias = mesaCero.alias || "Mesa de los Novios"; }
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
        if (relojEl) relojEl.innerHTML = `<span class="text-danger"><i class="bi bi-wifi-off me-1"></i>Sin conexión</span>`;
    }
}

function procesarDatosGenerales() {
    listaComensalesGenerales = []; 
    listaCancelables = []; 
    listaPendientes = [];
    listaDesglosadaMaestra = [];

    dataMaestra.forEach(m => {
        listaCancelables.push({ nombre_mostrar: m.nombre, nombre_principal: m.nombre, es_pareja: false });

        const conf = dataConfirmados.find(c => c.nombre_invitado === m.nombre);
        const estaConfirmado = !!conf;
        const titularCancelado = dataCancelados.some(c => quitarTildes(c.nombre.toLowerCase()) === quitarTildes(m.nombre.toLowerCase()));

        let estadoTitular = 'Pendiente';
        if (estaConfirmado) estadoTitular = 'Confirmado';
        else if (titularCancelado) estadoTitular = 'Cancelado';

        listaDesglosadaMaestra.push({
            id_maestra: m.id,
            nombre: m.nombre,
            nombre_principal: m.nombre,
            es_pareja: false,
            pareja_activa: parseInt(m.pareja) === 1,
            nino: parseInt(m.nino) === 1,
            lado: m.lado || 'Novio',
            estado: estadoTitular
        });

        if (parseInt(m.pareja) === 1) {
            const parejaConfirmada = conf && conf.lleva_pareja === "Sí";
            const nombreParejaPotencial = (conf && conf.nombre_pareja && conf.nombre_pareja !== '-' && conf.nombre_pareja.toLowerCase() !== 'pendiente') 
                ? conf.nombre_pareja 
                : `Pareja de ${m.nombre}`;

            const parejaCancelada = dataCancelados.some(c => {
                const cNom = quitarTildes(c.nombre.toLowerCase());
                return cNom === quitarTildes(nombreParejaPotencial.toLowerCase()) || 
                       cNom === quitarTildes(`Pareja de ${m.nombre}`.toLowerCase());
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
                lado: m.lado || 'Novio',
                estado: estadoPareja
            });

            if (!parejaConfirmada && !parejaCancelada) {
                listaPendientes.push({
                    nombre: nombreParejaPotencial,
                    tipo: 'Pareja',
                    nombre_principal: m.nombre,
                    es_pareja: true,
                    lado: m.lado || 'Novio',
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
                lado: m.lado || 'Novio',
                tiene_pareja_maestra: parseInt(m.pareja) === 1
            });
        }
    });

    dataConfirmados.forEach(c => {
        const infoMaestra = dataMaestra.find(m => m.nombre === c.nombre_invitado);
        const esNinoTitular = infoMaestra ? (infoMaestra.nino === 1) : false;
        const ladoTitular = infoMaestra ? (infoMaestra.lado || 'Novio') : 'Novio';
        
        listaComensalesGenerales.push({
            id_drag: `prin_${c.nombre_invitado}`,
            nombre_mostrar: c.nombre_invitado,
            nombre_principal: c.nombre_invitado,
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
                : `Pareja de ${c.nombre_invitado}`;
                
            listaComensalesGenerales.push({
                id_drag: `par_${c.nombre_invitado}`,
                nombre_mostrar: nombreP,
                nombre_principal: c.nombre_invitado,
                es_pareja: true,
                mesa: (c.mesa_pareja !== null && c.mesa_pareja !== undefined && c.mesa_pareja !== "") ? parseInt(c.mesa_pareja) : null,
                dieta: c.dieta_pareja || 'Ninguna',
                esNino: false,
                lado: ladoTitular,
                telefono: "-"
            });
            listaCancelables.push({ nombre_mostrar: nombreP, nombre_principal: c.nombre_invitado, es_pareja: true });
        }
    });
}

// ======================= GUARDADO EN BLOQUE =======================
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

// ======================= GESTIÓN Y RENUMERACIÓN DE MESAS =======================
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

    guardarEstadoHistorial();
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
    guardarEstadoHistorial();
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
    if(!confirm(`¿Eliminar la Mesa ${num}? Sus comensales volverán a 'Por Asignar' y las mesas siguientes se compactarán.`)) return; 

    guardarEstadoHistorial();
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
    document.getElementById('kpi-mesas-totales').innerText = dataMesas.length;
    document.getElementById('kpi-sillas-ocupadas').innerText = sillasOcupadas;
    document.getElementById('kpi-sillas-totales').innerText = sillasTotales;
    document.getElementById('kpi-pct-ocupacion').innerText = `${pct}%`;
    document.getElementById('kpi-sin-mesa').innerText = sinAsignar.length;
    document.getElementById('count-sin-asignar').innerText = sinAsignar.length;
}

function filtrarTrayPorAsignar(lado) {
    filtroTrayPorAsignarActual = lado;
    document.querySelectorAll('[id^="btn-filtro-tray-"]').forEach(b => b.classList.remove('active'));
    if (lado === 'todos') document.getElementById('btn-filtro-tray-todos').classList.add('active');
    else if (lado === 'Novio') document.getElementById('btn-filtro-tray-novio').classList.add('active');
    else if (lado === 'Novia') document.getElementById('btn-filtro-tray-novia').classList.add('active');
    else if (lado === 'nino') document.getElementById('btn-filtro-tray-nino').classList.add('active');
    dibujarListaSinAsignar();
}

function dibujarListaSinAsignar() {
    const sinAsignar = listaComensalesGenerales.filter(c => c.mesa === null || c.mesa === "");
    const term = quitarTildes((document.getElementById('buscador-por-asignar')?.value || '').toLowerCase().trim());
    
    let html = "";
    sinAsignar.forEach(c => {
        const matchSearch = term === "" || quitarTildes(c.nombre_mostrar.toLowerCase()).includes(term);
        let matchLado = (filtroTrayPorAsignarActual === 'todos');
        if (filtroTrayPorAsignarActual === 'Novio' && c.lado === 'Novio') matchLado = true;
        if (filtroTrayPorAsignarActual === 'Novia' && c.lado === 'Novia') matchLado = true;
        if (filtroTrayPorAsignarActual === 'nino' && c.esNino) matchLado = true;

        if (matchSearch && matchLado) {
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
    document.getElementById('lista-sin-asignar').innerHTML = html || `<p class="text-muted small mt-2 text-center">No hay comensales con este filtro.</p>`;
}

function filtrarPorAsignar() { dibujarListaSinAsignar(); }

// DIBUJAR MESAS: LIMPIO CON IDENTIDAD Y ENLACE A ASIENTOS.HTML
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
                        <i class="bi bi-people action-icon ms-1" title="Cambiar Sillas" onclick="cambiarCapacidad(${num}, ${cap})"></i>
                        <i class="bi bi-pencil-square action-icon" title="Renombrar Alias" onclick="editarAliasMesa(${num})"></i>
                        ${!esMesaNovios ? `<i class="bi bi-123 action-icon" title="Cambiar Número de Mesa" onclick="cambiarNumero(${num})"></i>` : ''}
                        ${!esMesaNovios ? `<i class="bi bi-trash action-icon trash-icon" title="Eliminar Mesa" onclick="eliminarMesa(${num})"></i>` : ''}
                    </div>
                    <span class="badge ${estaLlena ? 'bg-danger' : 'bg-success'}">${cant} / ${cap}</span>
                </div>

                <div class="drop-zone mb-2" style="max-height: 230px; overflow-y: auto;" ondragover="allowDropGuest(event)" ondragleave="leaveDropGuest(event)" ondrop="dropGuest(event, ${num}, ${cap}, ${cant})">
                    ${htmlOcupantes || '<div class="text-muted small mt-2 text-center">Mesa vacía</div>'}
                </div>

                <div class="d-flex gap-1 mt-2">
                    <button class="btn btn-outline-dark btn-sm flex-grow-1 py-1" style="font-size:0.75rem;" onclick="abrirModalSentarEnMesa(${num}, ${cap}, ${cant})" ${estaLlena ? 'disabled' : ''}>
                        ${estaLlena ? 'Mesa Completa' : '+ Sentar comensal'}
                    </button>
                    <!-- ENLACE DIRECTO A LA HERRAMIENTA SEPARADA DE ASIENTOS -->
                    <a href="asientos.html?mesa=${num}" target="_blank" class="btn btn-sm btn-outline-primary py-1 px-2 text-decoration-none" style="font-size:0.75rem;" title="Abrir gestor de asientos tipo plano">
                        <i class="bi bi-diagram-3-fill me-1"></i>Asientos
                    </a>
                </div>
            </div>
        </div>`;
    });

    document.getElementById('contenedor-mesas').innerHTML = htmlGrid || `<div class="col-12 text-center text-muted py-4">No hay mesas en esta categoría.</div>`;
}

// ======================= DRAG & DROP Y SUBIDA AUTOMÁTICA DE PAREJAS =======================
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

// ASIGNACIÓN INTELIGENTE: Sube automáticamente a la pareja si la tiene
function intentarAsignar(idDrag, mesaNum, capMax, capActual) {
    if (!idDrag) return; 
    const comensal = listaComensalesGenerales.find(c => c.id_drag === idDrag); 
    if (!comensal) return;
    
    if (mesaNum !== null && comensal.mesa !== null && parseInt(comensal.mesa) === parseInt(mesaNum)) return;
    
    guardarEstadoHistorial();

    if (mesaNum !== null) {
        // Detectar si tiene pareja para subirla automáticamente
        const pareja = listaComensalesGenerales.find(c => 
            c.nombre_principal === comensal.nombre_principal && c.id_drag !== comensal.id_drag
        );

        const tieneParejaSinMesa = pareja && (pareja.mesa === null || pareja.mesa !== mesaNum);

        if (tieneParejaSinMesa) {
            if (capActual + 2 > capMax) {
                alert(`¡Faltan sillas! Solo quedan ${capMax - capActual} puestos en la Mesa ${mesaNum}. No caben ambos comensales con pareja.`);
                return;
            }
            comensal.mesa = mesaNum;
            pareja.mesa = mesaNum;
        } else {
            if (capActual + 1 > capMax) {
                alert(`¡Faltan sillas! La mesa está completa.`);
                return;
            }
            comensal.mesa = mesaNum;
        }
    } else {
        const parejaMismaMesa = listaComensalesGenerales.find(c => 
            c.nombre_principal === comensal.nombre_principal && c.id_drag !== comensal.id_drag && c.mesa === comensal.mesa
        );
        comensal.mesa = null;
        if (parejaMismaMesa) parejaMismaMesa.mesa = null;
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
    guardarEstadoHistorial();
    const cap = document.getElementById('nueva-mesa-cap').value;
    const num = obtenerProximoNumeroDisponible();
    dataMesas.push({ numero: num, capacidad: parseInt(cap) || 10, alias: '' });
    dataMesas.sort((a, b) => parseInt(a.numero) - parseInt(b.numero));
    dibujarPanelMesas();
    marcarCambioPendienteMesas();
}

function cambiarCapacidad(numero, capActual) {
    guardarEstadoHistorial();
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
    
    guardarEstadoHistorial();
    if(mesaObj) mesaObj.alias = nuevo.trim();
    dibujarGridMesas();
    dibujarResumenMesasBanqueteria();
    marcarCambioPendienteMesas();
}

// ======================= BUSCADOR AMPLIADO =======================
function buscarComensalEnMesas(val) {
    const term = quitarTildes(val.toLowerCase().trim());
    document.querySelectorAll('.mesa-card').forEach(card => card.classList.remove('highlight-mesa'));
    if(term.length < 2) return;

    const comensal = listaComensalesGenerales.find(c => c.mesa !== null && quitarTildes(c.nombre_mostrar.toLowerCase()).includes(term));
    let mesaObjetivo = comensal ? parseInt(comensal.mesa) : null;

    if (!mesaObjetivo) {
        const mesa = dataMesas.find(m => {
            const aliasMatch = m.alias && quitarTildes(m.alias.toLowerCase()).includes(term);
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
    document.getElementById(`filtro-mesa-${tipo}`).classList.add('active');
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

// MODAL BUSCADOR CON AUTO-FOCUS
let candidatosSinMesaGlobal = [];
function abrirModalSentarEnMesa(numMesa, capMax, capActual) {
    mesaModalActiva = { num: numMesa, capMax: capMax, capActual: capActual };
    candidatosSinMesaGlobal = listaComensalesGenerales.filter(c => c.mesa === null || c.mesa === "");
    
    document.getElementById('modalSentarMesaTitulo').innerText = (numMesa === 1) ? `Sentar en Mesa 1 (Los Novios)` : `Sentar en Mesa ${numMesa}`;
    const inputBuscar = document.getElementById('modal-buscar-sin-asignar');
    inputBuscar.value = "";
    renderListaModalSinAsignar(candidatosSinMesaGlobal);

    const modalInstance = new bootstrap.Modal(document.getElementById('modalSentarEnMesa'));
    modalInstance.show();

    // AUTO-FOCUS INMEDIATO
    setTimeout(() => {
        if (inputBuscar) {
            inputBuscar.focus();
            inputBuscar.select();
        }
    }, 400);
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
    const term = quitarTildes(val.toLowerCase().trim());
    renderListaModalSinAsignar(candidatosSinMesaGlobal.filter(c => quitarTildes(c.nombre_mostrar.toLowerCase()).includes(term)));
}

function ejecutarSentarDesdeModal(idDrag) {
    if(!mesaModalActiva) return;
    bootstrap.Modal.getInstance(document.getElementById('modalSentarEnMesa')).hide();
    intentarAsignar(idDrag, mesaModalActiva.num, mesaModalActiva.capMax, mesaModalActiva.capActual);
}

// ======================= BANQUETERÍA =======================
function dibujarPanelBanqueteria() {
    let adultos = 0, ninos = 0, dietasDinamicas = {};
    listaComensalesGenerales.forEach(c => {
        if (c.esNino) ninos++; else adultos++;
        if (c.dieta !== "Ninguna" && c.dieta !== "-") dietasDinamicas[c.dieta] = (dietasDinamicas[c.dieta] || 0) + 1;
    });

    document.getElementById('adult-val').innerText = adultos; 
    document.getElementById('nino-val').innerText = ninos;
    document.getElementById('fiesta-banquet-val').innerText = listaInvitadosFiesta.length;

    const contenedorDietas = document.getElementById('contenedor-dietas'); contenedorDietas.innerHTML = ""; tarjetasDietas = [];
    if (Object.keys(dietasDinamicas).length === 0) contenedorDietas.innerHTML = `<div class="col-12"><p class="text-muted small">No hay comensales con dietas especiales registradas.</p></div>`;

    for (const [dieta, cantidad] of Object.entries(dietasDinamicas)) {
        const col = document.createElement('div'); col.className = 'col-6 col-md-3 col-lg-2';
        const card = document.createElement('div'); card.className = 'stat-card filtrable';
        card.onclick = () => renderTablaBanqueteria(dieta);
        tarjetasDietas.push({ elemento: card, nombreDieta: dieta });
        card.innerHTML = `<h6 class="small fw-bold text-truncate m-0 mb-2" title="${dieta}">${dieta}</h6><div class="stat-val">${cantidad}</div>`;
        col.appendChild(card); contenedorDietas.appendChild(col);
    }
    renderTablaBanqueteria(filtroActualBanqueteria);
    dibujarResumenMesasBanqueteria();
}

function dibujarResumenMesasBanqueteria() {
    const cont = document.getElementById('contenedor-mesas-banquetera');
    if (!cont) return;

    let html = "";
    dataMesas.forEach(m => {
        const num = parseInt(m.numero);
        const esNovios = (num === 1);
        const ocupantes = listaComensalesGenerales.filter(c => c.mesa !== null && parseInt(c.mesa) === num);
        
        let adultosMesa = 0, ninosMesa = 0;
        let especiales = [];

        ocupantes.forEach(o => {
            if (o.esNino) {
                ninosMesa++;
                especiales.push({ nombre: o.nombre_mostrar, plato: "Menú Infantil (Niño)" });
            } else {
                adultosMesa++;
            }

            if (o.dieta && o.dieta !== "Ninguna" && o.dieta !== "-") {
                especiales.push({ nombre: o.nombre_mostrar, plato: o.dieta });
            }
        });

        const aliasText = m.alias ? ` - ${escapeHTML(m.alias)}` : '';
        const tituloMesa = esNovios ? `👑 Mesa 1 (Los Novios)${aliasText}` : `Mesa ${num}${aliasText}`;

        let htmlEspeciales = "";
        if (especiales.length > 0) {
            htmlEspeciales = `<div class="p-2 mb-2 rounded" style="background:#fff7e6; border:1px solid #ffd591;">
                <span class="d-block small fw-bold text-dark mb-1"><i class="bi bi-exclamation-triangle-fill text-warning me-1"></i>Platos Especiales (${especiales.length}):</span>
                <ul class="mb-0 ps-3 small" style="font-size:0.78rem;">
                    ${especiales.map(e => `<li><strong>${escapeHTML(e.nombre)}:</strong> <span class="text-danger fw-semibold">${escapeHTML(e.plato)}</span></li>`).join('')}
                </ul>
            </div>`;
        } else {
            htmlEspeciales = `<div class="small text-success mb-2"><i class="bi bi-check-circle-fill me-1"></i>Todos comen Menú Adulto Estándar</div>`;
        }

        html += `
        <div class="col-12 col-md-6 col-lg-4">
            <div class="bg-white p-3 rounded shadow-sm border h-100" style="border-top: 4px solid ${esNovios ? '#d4af37' : 'var(--oro)'} !important;">
                <div class="d-flex justify-content-between align-items-center mb-2 pb-2 border-bottom">
                    <h6 class="m-0 fw-bold" style="font-family:'Playfair Display', serif;">${tituloMesa}</h6>
                    <span class="badge bg-dark">${ocupantes.length} sentados</span>
                </div>
                <div class="small text-muted mb-2">
                    <span>Adultos: <strong>${adultosMesa}</strong></span> · 
                    <span>Niños: <strong>${ninosMesa}</strong></span>
                </div>
                ${htmlEspeciales}
                <div class="small text-muted border-top pt-2" style="font-size:0.75rem;">
                    <span class="fw-bold d-block mb-1">Comensales:</span>
                    ${ocupantes.length ? ocupantes.map(o => `<span class="badge bg-light text-dark border me-1 mb-1">${escapeHTML(o.nombre_mostrar)}</span>`).join('') : '<span class="text-muted">Mesa vacía</span>'}
                </div>
            </div>
        </div>`;
    });

    cont.innerHTML = html || `<div class="col-12 text-center text-muted py-3">No hay mesas configuradas aún.</div>`;
}

function renderTablaBanqueteria(filtro = filtroActualBanqueteria) {
    filtroActualBanqueteria = filtro;
    const term = quitarTildes(document.getElementById('buscador-banqueteria').value.toLowerCase().trim());
    
    tarjetasDietas.forEach(t => { t.elemento.classList.toggle('active-filter', filtro !== 'Todas' && filtro !== 'Niños' && t.nombreDieta === filtro); });
    document.getElementById('card-ninos').classList.toggle('active-filter', filtro === 'Niños');
    document.getElementById('titulo-tabla-banqueteria').innerText = filtro === 'Todas' ? 'Todos los Comensales Cena' : (filtro === 'Niños' ? 'Filtrando por: Menú Infantil (Niños)' : `Filtrando por: ${filtro}`);

    let html = "";
    listaComensalesGenerales.forEach(c => {
        let matchFiltro = (filtro === 'Todas') || (filtro === 'Niños' && c.esNino) || (filtro !== 'Todas' && filtro !== 'Niños' && c.dieta === filtro);
        let matchSearch = term === "" || quitarTildes(c.nombre_mostrar.toLowerCase()).includes(term);

        if (matchFiltro && matchSearch) {
            const mesaStr = c.mesa ? (parseInt(c.mesa) === 1 ? `👑 Mesa 1 (Novios)` : `Mesa ${c.mesa}`) : `<span class="text-danger small">Sin mesa</span>`;
            html += `<tr ${c.es_pareja ? 'style="background-color: #fdfbf7;"' : ''}>
                <td class="${c.es_pareja ? 'ps-4' : ''}">${c.es_pareja ? '↳ ' : ''}<strong>${escapeHTML(c.nombre_mostrar)}</strong></td>
                <td><span class="badge ${c.es_pareja ? 'bg-secondary' : 'bg-primary'}">${c.es_pareja ? 'Pareja' : 'Titular'}</span></td>
                <td>${mesaStr}</td>
                <td><span class="dieta-editable" title="Click para editar" onclick="editarDietaUI('${c.id_drag}')">${escapeHTML(c.dieta)}</span></td>
                <td><span class="badge ${c.esNino ? 'badge-nino' : 'bg-success'}">${c.esNino ? 'Niño' : 'Adulto'}</span></td>
            </tr>`;
        }
    });
    document.getElementById('lista-tabla-banqueteria').innerHTML = html || `<tr><td colspan="5" class="text-center text-muted">No hay resultados.</td></tr>`;
}

function editarDietaUI(idDrag) {
    const comensal = listaComensalesGenerales.find(c => c.id_drag === idDrag);
    if(!comensal) return;
    const nuevaDieta = prompt(`Escribe la nueva restricción para ${comensal.nombre_mostrar}:`, comensal.dieta);
    if(nuevaDieta === null) return; 
    
    const dietaFinal = nuevaDieta.trim() === "" ? "Ninguna" : nuevaDieta.trim();
    comensal.dieta = dietaFinal;
    
    const conf = dataConfirmados.find(c => c.nombre_invitado === comensal.nombre_principal);
    if(conf) {
        if(comensal.es_pareja) conf.dieta_pareja = dietaFinal;
        else conf.dieta = dietaFinal;
    }

    dibujarPanelBanqueteria(); dibujarPanelConfirmaciones(); dibujarPanelMesas();
    addToQueue({ tipo: "editar_dieta", nombre_principal: comensal.nombre_principal, es_pareja: comensal.es_pareja, nueva_dieta: dietaFinal });
}

// ======================= CONFIRMACIONES CON FILTRO NOVIO/NOVIA =======================
function filtrarConfirmacionesLado(lado) {
    filtroConfirmacionesLadoActual = lado;
    document.querySelectorAll('[id^="btn-conf-filtro-"]').forEach(b => b.classList.remove('active'));
    if (lado === 'todos') document.getElementById('btn-conf-filtro-todos').classList.add('active');
    else if (lado === 'Novio') document.getElementById('btn-conf-filtro-novio').classList.add('active');
    else if (lado === 'Novia') document.getElementById('btn-conf-filtro-novia').classList.add('active');
    else if (lado === 'Ambos') document.getElementById('btn-conf-filtro-ambos').classList.add('active');
    dibujarPanelConfirmaciones();
}

function dibujarPanelConfirmaciones() {
    const term = quitarTildes((document.getElementById('buscador-confirmados')?.value || '').toLowerCase().trim());
    const termPend = quitarTildes((document.getElementById('buscador-pendientes')?.value || '').toLowerCase().trim());

    let filtradosConf = listaComensalesGenerales;
    let filtradosPend = listaPendientes;
    let filtradosCanc = dataCancelados;

    if (filtroConfirmacionesLadoActual !== 'todos') {
        filtradosConf = listaComensalesGenerales.filter(c => c.lado === filtroConfirmacionesLadoActual);
        filtradosPend = listaPendientes.filter(p => p.lado === filtroConfirmacionesLadoActual);
        filtradosCanc = dataCancelados.filter(c => {
            const m = dataMaestra.find(x => x.nombre === c.nombre);
            return m && m.lado === filtroConfirmacionesLadoActual;
        });
    }

    document.getElementById('val-confirmados').innerText = filtradosConf.length;
    document.getElementById('val-pendientes').innerText = filtradosPend.length;
    document.getElementById('val-cancelados').innerText = filtradosCanc.length;

    let htmlConf = "";
    filtradosConf.forEach(c => {
        if (term === "" || quitarTildes(c.nombre_mostrar.toLowerCase()).includes(term)) {
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
    document.getElementById('tabla-confirmados').innerHTML = htmlConf || `<tr><td colspan="5" class="text-center text-muted">No hay resultados.</td></tr>`;

    let htmlPend = "";
    filtradosPend.forEach(p => {
        if (termPend === "" || quitarTildes(p.nombre.toLowerCase()).includes(termPend)) {
            const btnConfirmar = `<button class="btn btn-sm btn-outline-success py-0 px-2 me-1" title="Confirmar asistencia" onclick="confirmarDesdePendientes('${escapeHTML(p.nombre_principal)}', ${p.es_pareja}, '${escapeHTML(p.nombre)}')"><i class="bi bi-check-lg"></i></button>`;
            const btnBajar = `<button class="btn btn-sm btn-outline-danger py-0 px-2 me-1" title="Bajar a Cancelados" onclick="cancelarDesdePendientes('${escapeHTML(p.nombre_principal)}', ${p.es_pareja})"><i class="bi bi-x-circle"></i></button>`;
            
            const titularTieneParejaActiva = listaPendientes.some(x => x.nombre_principal === p.nombre_principal && x.es_pareja) || 
                                             dataConfirmados.some(c => c.nombre_invitado === p.nombre_principal && c.lleva_pareja === 'Sí');
            
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
    document.getElementById('tabla-pendientes').innerHTML = htmlPend || `<tr><td colspan="3" class="text-center text-muted">No hay resultados.</td></tr>`;

    let htmlCanc = "";
    filtradosCanc.forEach(c => {
        htmlCanc += `<tr><td><strong>${escapeHTML(c.nombre)}</strong></td><td><span class="text-muted small">${escapeHTML(c.mensaje || '-')}</span></td></tr>`;
    });
    document.getElementById('tabla-cancelados').innerHTML = htmlCanc || `<tr><td colspan="2" class="text-center text-muted">No hay resultados.</td></tr>`;
}

// CONFIRMACIÓN GUIADA DE PAREJAS EN PENDIENTES
function confirmarDesdePendientes(nombrePrincipal, esPareja, nombreMostrar) {
    let conf = dataConfirmados.find(c => c.nombre_invitado === nombrePrincipal);
    const m = dataMaestra.find(x => x.nombre === nombrePrincipal);
    const tieneParejaMaestra = m && parseInt(m.pareja) === 1;

    if (esPareja) {
        if (!confirm(`¿Confirmar a la pareja ${nombreMostrar}?`)) return;
        if (conf) {
            conf.lleva_pareja = "Sí";
            conf.nombre_pareja = nombreMostrar;
        } else {
            dataConfirmados.push({ nombre_invitado: nombrePrincipal, lleva_pareja: "Sí", nombre_pareja: nombreMostrar, telefono: "-", dieta: "Ninguna", dieta_pareja: "Ninguna", mesa_numero: null });
        }
        dataCancelados = dataCancelados.filter(c => !quitarTildes(c.nombre.toLowerCase()).includes(quitarTildes(nombrePrincipal.toLowerCase())));
        addToQueue({ tipo: "admin_confirmar", nombre_principal: nombrePrincipal, es_pareja: true });
    } else {
        if (tieneParejaMaestra) {
            const confirmaConPareja = confirm(`¿${nombrePrincipal} asistirá CON su pareja?\n\n[Aceptar] = Confirmar a Ambos\n[Cancelar] = Confirmar SOLO al titular`);
            
            if (confirmaConPareja) {
                if (!conf) {
                    dataConfirmados.push({ nombre_invitado: nombrePrincipal, lleva_pareja: "Sí", nombre_pareja: `Pareja de ${nombrePrincipal}`, telefono: "-", dieta: "Ninguna", dieta_pareja: "Ninguna", mesa_numero: null });
                } else {
                    conf.lleva_pareja = "Sí";
                    if (!conf.nombre_pareja || conf.nombre_pareja === '-') conf.nombre_pareja = `Pareja de ${nombrePrincipal}`;
                }
                dataCancelados = dataCancelados.filter(c => !quitarTildes(c.nombre.toLowerCase()).includes(quitarTildes(nombrePrincipal.toLowerCase())));
                addToQueue({ tipo: "admin_confirmar", nombre_principal: nombrePrincipal, es_pareja: true });
            } else {
                const parejaEnPendientes = confirm(`¿Qué deseas hacer con la pareja de ${nombrePrincipal}?\n\n[Aceptar] = Dejar a la pareja en PENDIENTES\n[Cancelar] = Marcar a la pareja como CANCELADA (No asistirá)`);

                if (!conf) {
                    dataConfirmados.push({ nombre_invitado: nombrePrincipal, lleva_pareja: "No", telefono: "-", dieta: "Ninguna", mesa_numero: null });
                } else {
                    conf.lleva_pareja = "No";
                }

                if (parejaEnPendientes) {
                    dataCancelados = dataCancelados.filter(c => c.nombre !== `Pareja de ${nombrePrincipal}`);
                    addToQueue({ tipo: "admin_confirmar", nombre_principal: nombrePrincipal, es_pareja: false });
                } else {
                    dataCancelados.push({ nombre: `Pareja de ${nombrePrincipal}`, mensaje: "No asiste (confirmó solo el titular)" });
                    addToQueue({ tipo: "admin_cancelar", nombre_principal: nombrePrincipal, es_pareja: true });
                    addToQueue({ tipo: "admin_confirmar", nombre_principal: nombrePrincipal, es_pareja: false });
                }
            }
        } else {
            if (!confirm(`¿Confirmar la asistencia de ${nombrePrincipal}?`)) return;
            if (!conf) {
                dataConfirmados.push({ nombre_invitado: nombrePrincipal, lleva_pareja: "No", telefono: "-", dieta: "Ninguna", mesa_numero: null });
            }
            dataCancelados = dataCancelados.filter(c => c.nombre !== nombrePrincipal);
            addToQueue({ tipo: "admin_confirmar", nombre_principal: nombrePrincipal, es_pareja: false });
        }
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
        const ms = dataMaestra.find(m => m.nombre === nombrePrincipal);
        if(ms && parseInt(ms.pareja) === 1) dataCancelados.push({ nombre: `Pareja de ${nombrePrincipal}`, mensaje: "Titular dado de baja" });
    } else {
        dataCancelados.push({ nombre: `Pareja de ${nombrePrincipal}`, mensaje: "Dado de baja" });
    }
    
    procesarDatosGenerales(); dibujarPanelConfirmaciones(); dibujarTablaListaMaestra();
    addToQueue({ tipo: "admin_cancelar", nombre_principal: nombrePrincipal, es_pareja: esPareja });
}

function bajarDesdeConfirmados(idDrag) {
    const comensal = listaComensalesGenerales.find(c => c.id_drag === idDrag);
    if (!comensal) return;

    if (comensal.es_pareja) {
        if (!confirm(`¿Dar de baja a la pareja ${comensal.nombre_mostrar}?`)) return;
        const conf = dataConfirmados.find(c => c.nombre_invitado === comensal.nombre_principal);
        if (conf) { conf.lleva_pareja = 'No'; conf.nombre_pareja = '-'; conf.dieta_pareja = '-'; conf.mesa_pareja = null; }
        dataCancelados.push({ nombre: comensal.nombre_mostrar, mensaje: 'Cancelada manualmente' });
        addToQueue({ tipo: "admin_cancelar", nombre_principal: comensal.nombre_principal, es_pareja: true });
    } else {
        const conf = dataConfirmados.find(c => c.nombre_invitado === comensal.nombre_principal);
        const tienePareja = conf && conf.lleva_pareja === 'Sí';
        let advertencia = `¿Dar de baja a ${comensal.nombre_mostrar}?`;
        if (tienePareja) advertencia += `\nSu pareja registrada (${conf.nombre_pareja || 'Pareja'}) también será dada de baja.`;
        if (!confirm(advertencia)) return;

        dataConfirmados = dataConfirmados.filter(c => c.nombre_invitado !== comensal.nombre_principal);
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
    const conf = dataConfirmados.find(c => c.nombre_invitado === nombrePrincipal);
    if (!conf) return;

    const nombreP = prompt(`Nombre de la pareja para ${nombrePrincipal}:\n(Deja en blanco para 'Pareja de ${nombrePrincipal}')`);
    if (nombreP === null) return;
    const dietaP = prompt(`Restricción alimentaria de la pareja (opcional):`);
    if (dietaP === null) return;

    const nombreFinal = nombreP.trim() !== "" ? nombreP.trim() : `Pareja de ${nombrePrincipal}`;
    const dietaFinal = dietaP.trim() !== "" ? dietaP.trim() : "Ninguna";

    conf.lleva_pareja = "Sí"; conf.nombre_pareja = nombreFinal; conf.dieta_pareja = dietaFinal;
    const m = dataMaestra.find(item => item.nombre === nombrePrincipal); if (m) m.pareja = 1;

    dataCancelados = dataCancelados.filter(c => {
        const cNom = quitarTildes(c.nombre.toLowerCase());
        return cNom !== quitarTildes(nombreFinal.toLowerCase()) && cNom !== quitarTildes(`Pareja de ${nombrePrincipal}`.toLowerCase());
    });

    procesarDatosGenerales(); dibujarPanelConfirmaciones(); dibujarPanelBanqueteria(); dibujarPanelMesas(); dibujarTablaListaMaestra();
    addToQueue({ tipo: "admin_agregar_pareja_confirmado", nombre_principal: nombrePrincipal, nombre_pareja: nombreFinal, dieta_pareja: dietaFinal });
}

function agregarParejaAPendiente(nombrePrincipal) {
    if (!confirm(`¿Habilitar acompañante (+1) para ${nombrePrincipal}?`)) return;
    const m = dataMaestra.find(item => item.nombre === nombrePrincipal); if (m) m.pareja = 1;
    dataCancelados = dataCancelados.filter(c => quitarTildes(c.nombre.toLowerCase()) !== quitarTildes(`Pareja de ${nombrePrincipal}`.toLowerCase()));
    procesarDatosGenerales(); dibujarPanelConfirmaciones(); dibujarTablaListaMaestra();
    addToQueue({ tipo: "admin_habilitar_pareja", nombre_principal: nombrePrincipal });
}

// ======================= LISTA MAESTRA =======================
function dibujarTablaListaMaestra() {
    const term = quitarTildes((document.getElementById('buscador-maestra')?.value || '').toLowerCase().trim());
    
    let totalTitulares = dataMaestra.length;
    let totalParejas = dataMaestra.filter(m => parseInt(m.pareja) === 1).length;
    let totalSillas = totalTitulares + totalParejas;
    
    let countNovio = 0, countNovia = 0, countAmbos = 0;
    listaDesglosadaMaestra.forEach(item => {
        if (item.lado === 'Novia') countNovia++;
        else if (item.lado === 'Ambos') countAmbos++;
        else countNovio++;
    });

    document.getElementById('maestra-total-titulares').innerText = totalTitulares;
    document.getElementById('maestra-total-parejas').innerText = totalParejas;
    document.getElementById('maestra-total-sillas').innerText = totalSillas;
    document.getElementById('maestra-count-novio').innerText = countNovio;
    document.getElementById('maestra-count-novia').innerText = countNovia;
    document.getElementById('maestra-count-ambos').innerText = countAmbos;

    let html = "";
    let numeroCorrelativo = 1;

    listaDesglosadaMaestra.forEach(item => {
        const matchLado = (filtroLadoMaestraActual === 'todos') || (item.lado === filtroLadoMaestraActual);
        const matchBusqueda = term === "" || 
            quitarTildes(item.nombre.toLowerCase()).includes(term) || 
            quitarTildes(item.nombre_principal.toLowerCase()).includes(term);

        const currentNum = numeroCorrelativo++;

        if (matchLado && matchBusqueda) {
            let estadoBadge = '<span class="badge bg-warning text-dark">Pendiente</span>';
            if (item.estado === 'Confirmado') estadoBadge = '<span class="badge bg-success">Confirmado</span>';
            else if (item.estado === 'Cancelado') estadoBadge = '<span class="badge bg-danger">Cancelado</span>';

            let ladoIcon = '🤵 Novio';
            let ladoClass = 'badge-novio';
            if (item.lado === 'Novia') { ladoIcon = '👰 Novia'; ladoClass = 'badge-novia'; }
            else if (item.lado === 'Ambos') { ladoIcon = '💍 Ambos'; ladoClass = 'badge-ambos'; }

            let columnaPareja = '';
            let columnaAcciones = '';

            if (!item.es_pareja) {
                columnaPareja = `
                    <button class="btn btn-sm ${item.pareja_activa ? 'btn-outline-primary' : 'btn-outline-secondary'} py-0 px-2" style="font-size:0.75rem;" onclick="alternarParejaMaestra(${item.id_maestra})">
                        ${item.pareja_activa ? '<i class="bi bi-people-fill me-1"></i>Con Pareja' : '<i class="bi bi-person me-1"></i>Solo'}
                    </button>`;
                
                columnaAcciones = `
                    <button class="btn btn-sm btn-outline-danger py-0 px-2" title="Eliminar titular" onclick="eliminarInvitadoMaestra(${item.id_maestra}, '${escapeHTML(item.nombre)}')">
                        <i class="bi bi-trash"></i>
                    </button>`;
            } else {
                columnaPareja = `<span class="badge bg-light text-secondary border"><i class="bi bi-link-45deg me-1"></i>Acompañante</span>`;
                columnaAcciones = `
                    <button class="btn btn-sm btn-outline-warning py-0 px-2" title="Quitar pareja" onclick="alternarParejaMaestra(${item.id_maestra})">
                        <i class="bi bi-person-dash"></i>
                    </button>`;
            }

            html += `
            <tr ${item.es_pareja ? 'style="background-color: #fcfaf7;"' : ''}>
                <td class="text-muted fw-bold">${currentNum}</td>
                <td class="${item.es_pareja ? 'ps-4' : ''}">
                    ${item.es_pareja ? '<span class="text-muted me-1">↳</span>' : ''}
                    <strong ${item.es_pareja ? 'class="fw-semibold text-secondary"' : ''}>${escapeHTML(item.nombre)}</strong>
                </td>
                <td>
                    <span class="badge ${ladoClass} ${!item.es_pareja ? 'lado-selector' : ''}" ${!item.es_pareja ? `onclick="alternarLadoMaestra(${item.id_maestra})"` : ''}>
                        ${ladoIcon}
                    </span>
                </td>
                <td><span class="badge ${item.es_pareja ? 'bg-secondary' : 'bg-primary'}">${item.es_pareja ? 'Pareja' : 'Titular'}</span></td>
                <td>${columnaPareja}</td>
                <td><span class="badge ${item.nino ? 'badge-nino' : 'bg-light text-dark border'}">${item.nino ? 'Niño' : 'Adulto'}</span></td>
                <td>${estadoBadge}</td>
                <td>${columnaAcciones}</td>
            </tr>`;
        }
    });

    document.getElementById('tabla-lista-maestra').innerHTML = html || `<tr><td colspan="8" class="text-center text-muted py-4">No se encontraron comensales.</td></tr>`;
}

function filtrarLadoMaestra(lado) {
    filtroLadoMaestraActual = lado;
    document.querySelectorAll('[id^="btn-filtro-lado-"]').forEach(btn => btn.classList.remove('active'));
    if (lado === 'todos') document.getElementById('btn-filtro-lado-todos').classList.add('active');
    else if (lado === 'Novio') document.getElementById('btn-filtro-lado-novio').classList.add('active');
    else if (lado === 'Novia') document.getElementById('btn-filtro-lado-novia').classList.add('active');
    else if (lado === 'Ambos') document.getElementById('btn-filtro-lado-ambos').classList.add('active');
    dibujarTablaListaMaestra();
}

function alternarLadoMaestra(id) {
    const item = dataMaestra.find(m => parseInt(m.id) === parseInt(id));
    if (!item) return;

    const orden = ['Novio', 'Novia', 'Ambos'];
    let idx = orden.indexOf(item.lado || 'Novio');
    let nuevoLado = orden[(idx + 1) % orden.length];
    
    item.lado = nuevoLado;
    procesarDatosGenerales();
    dibujarTablaListaMaestra();
    dibujarPanelMesas();
    addToQueue({ tipo: "editar_lado_maestra", id: item.id, lado: nuevoLado });
}

function alternarParejaMaestra(id) {
    const item = dataMaestra.find(m => parseInt(m.id) === parseInt(id));
    if (!item) return;

    const nuevaPareja = parseInt(item.pareja) === 1 ? 0 : 1;
    item.pareja = nuevaPareja;
    
    if (nuevaPareja === 0) {
        const conf = dataConfirmados.find(c => c.nombre_invitado === item.nombre);
        if (conf) {
            conf.lleva_pareja = 'No'; conf.nombre_pareja = '-'; conf.dieta_pareja = '-'; conf.mesa_pareja = null;
        }
    }

    procesarDatosGenerales();
    dibujarTablaListaMaestra();
    dibujarPanelConfirmaciones();
    dibujarPanelBanqueteria();
    dibujarPanelMesas();
    
    addToQueue({ tipo: "editar_pareja_maestra", id: item.id, pareja: nuevaPareja });
}

function abrirModalAgregarInvitado() {
    document.getElementById('modal-nuevo-nombre').value = "";
    document.getElementById('modal-nuevo-lado').value = "Novio";
    document.getElementById('modal-nuevo-pareja').checked = false;
    document.getElementById('modal-nuevo-nino').checked = false;
    new bootstrap.Modal(document.getElementById('modalAgregarInvitado')).show();
}

function guardarInvitadoModalMaestra(e) {
    e.preventDefault();
    const nombre = document.getElementById('modal-nuevo-nombre').value.trim();
    const lado = document.getElementById('modal-nuevo-lado').value;
    const pareja = document.getElementById('modal-nuevo-pareja').checked ? 1 : 0;
    const nino = document.getElementById('modal-nuevo-nino').checked ? 1 : 0;

    if (!nombre) return;
    if (dataMaestra.some(m => quitarTildes(m.nombre.toLowerCase()) === quitarTildes(nombre.toLowerCase()))) {
        alert("Ese invitado ya existe en la lista maestra."); return;
    }

    const proximoId = dataMaestra.reduce((max, obj) => Math.max(max, parseInt(obj.id) || 0), 0) + 1;
    const nuevoObj = { id: proximoId, nombre: nombre, pareja: pareja, nino: nino, lado: lado };
    
    dataMaestra.push(nuevoObj);
    bootstrap.Modal.getInstance(document.getElementById('modalAgregarInvitado')).hide();

    procesarDatosGenerales();
    dibujarTablaListaMaestra();
    dibujarPanelConfirmaciones();

    addToQueue({ tipo: "agregar_maestra", id: proximoId, nombre: nombre, pareja: pareja, nino: nino, lado: lado });
}

function eliminarInvitadoMaestra(id, nombre) {
    if (!confirm(`¿Eliminar definitivamente a "${nombre}" de la Lista Maestra?`)) return;

    dataMaestra = dataMaestra.filter(m => parseInt(m.id) !== parseInt(id));
    dataConfirmados = dataConfirmados.filter(c => c.nombre_invitado !== nombre);
    dataCancelados = dataCancelados.filter(c => c.nombre !== nombre && c.nombre !== `Pareja de ${nombre}`);
    listaComensalesGenerales = listaComensalesGenerales.filter(c => c.nombre_principal !== nombre);

    procesarDatosGenerales();
    dibujarTablaListaMaestra();
    dibujarPanelConfirmaciones();
    dibujarPanelBanqueteria();
    dibujarPanelMesas();

    addToQueue({ tipo: "eliminar_maestra", id: id, nombre: nombre });
}

function exportarExcelListaMaestra() {
    let data = [];
    let correlativo = 1;
    listaDesglosadaMaestra.forEach(item => {
        data.push({
            "#": correlativo++,
            "Nombre del Comensal": item.nombre,
            "Tipo": item.es_pareja ? "Pareja" : "Titular",
            "Titular": item.nombre_principal,
            "Lado": item.lado,
            "Menú": item.nino ? "Niño" : "Adulto",
            "Estado": item.estado
        });
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Lista Maestra Completa");
    XLSX.writeFile(wb, "Matrimonio_Lista_Maestra.xlsx");
}

// ======================= EXCEL EXPORTS =======================
function exportarExcelMesas() {
    let data = [];
    let invitadosPorMesa = [...listaComensalesGenerales].sort((a, b) => {
        let mA = a.mesa === null ? 9999 : parseInt(a.mesa);
        let mB = b.mesa === null ? 9999 : parseInt(b.mesa);
        return mA - mB;
    });

    invitadosPorMesa.forEach(c => {
        let nombreMesa = "Sin Asignar";
        if(c.mesa !== null && c.mesa !== "") { 
            const numM = parseInt(c.mesa);
            const mesaObj = dataMesas.find(m => parseInt(m.numero) === numM);
            const aliasM = (mesaObj && mesaObj.alias) ? ` (${mesaObj.alias})` : '';
            nombreMesa = numM === 1 ? `👑 Mesa 1 (Los Novios)${aliasM}` : `Mesa ${numM}${aliasM}`; 
        }
        data.push({ 
            "Mesa": nombreMesa, 
            "Nombre": c.nombre_mostrar, 
            "Tipo": c.es_pareja ? "Pareja" : "Titular", 
            "Lado": c.lado,
            "Restricción Alimentaria": c.dieta,
            "Menú": c.esNino ? "Niño" : "Adulto"
        });
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Plano de Mesas");
    XLSX.writeFile(wb, "Matrimonio_Mesas.xlsx");
}

function exportarExcelBanqueteria() {
    let data = listaComensalesGenerales.map(c => ({
        "Nombre": c.nombre_mostrar,
        "Tipo": c.es_pareja ? "Pareja" : "Titular",
        "Mesa": c.mesa ? (parseInt(c.mesa) === 1 ? "👑 Mesa 1 (Novios)" : `Mesa ${c.mesa}`) : "Sin asignar",
        "Restricción Alimentaria": c.dieta,
        "Menú": c.esNino ? "Niño" : "Adulto"
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Banquetería");
    XLSX.writeFile(wb, "Matrimonio_Banqueteria.xlsx");
}

function exportarExcelConfirmaciones() {
    let confData = listaComensalesGenerales.map(c => ({ "Nombre": c.nombre_mostrar, "Tipo": c.es_pareja ? "Pareja" : "Titular", "Teléfono": c.telefono || "-", "Restricción Alimentaria": c.dieta }));
    let pendData = listaPendientes.map(p => ({ "Nombre": p.nombre, "Tipo": p.tipo }));
    let cancData = dataCancelados.map(c => ({ "Nombre": c.nombre, "Motivo": c.mensaje || "-" }));
    let fiestaData = listaInvitadosFiesta.map((f, i) => ({ "#": i + 1, "Nombre": f.nombre, "Tipo": f.es_pareja ? "Pareja" : "Titular" }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(confData), "Cena Confirmados");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(fiestaData), "Fiesta Confirmados");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pendData), "Cena Pendientes");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cancData), "Cena Cancelados");
    XLSX.writeFile(wb, "Matrimonio_Confirmaciones.xlsx");
}

// Auto-arranque de sesión
if (sessionStorage.getItem('matri_unlocked')) {
    init();
}