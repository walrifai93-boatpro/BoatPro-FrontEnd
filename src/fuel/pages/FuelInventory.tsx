import React, { useMemo, useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Plus, RefreshCw, PackageOpen, Thermometer, Droplet, Pencil, Trash2 } from 'lucide-react'
import { money, toTank, toSupplier, toFuelType, leadTimeLabel, type Tank, type FuelType } from '../fuelData'
import { fuelApi, type ProductUnit } from '../fuelApi'
import { useFuel, useFuelResource } from '../fuelStore'
import { Section, Modal, LoadingState, ErrorState, LoadingButton, toast, download } from '../../ui'
import { FuelHeader, FBadge, TankGauge } from '../fuelUi'
import { StationApprovalNotice, isStationUnapproved } from '../components/StationApprovalNotice'
import { confirmAndRun } from '../../async'
import { useLimitAwareAction } from '../../shared/packageLimit'
import { formatPortalNumber, localizedField, portalLocale, translatePortalText } from '../../i18n/runtime'

export default function FuelInventory() {
  const location = useLocation()
  const { refresh, currentStationId, currentStation, isAllStations, stations } = useFuel()
  const inv = useFuelResource(
    () => fuelApi.inventory(isAllStations ? undefined : currentStationId ?? undefined, isAllStations).then((r) => r.data),
    [currentStationId, isAllStations],
  )

  const stationsList = useMemo(() => {
    if (inv.data?.stations?.length) return inv.data.stations
    return stations || []
  }, [inv.data?.stations, stations])

  const [addTank, setAddTank] = useState(false)
  const [editTank, setEditTank] = useState<Tank | null>(null)
  const [addProduct, setAddProduct] = useState(false)
  const [addSupplier, setAddSupplier] = useState(false)
  const [refill, setRefill] = useState<Tank | null>(null)
  const [poOpen, setPoOpen] = useState(false)
  const [editFuel, setEditFuel] = useState<FuelType | null>(null)
  const [editForm, setEditForm] = useState({ name: '', price: '', unit: 'gal' as ProductUnit, icon: '⛽', color: '#f59e0b', bulk: true })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const handleFocus = (e: any) => {
      const id = e.detail?.id || location.hash.replace(/^#/, '')
      if (id === 'tanks' || id === 'add-tank' || id === 'storage_tanks') {
        setAddTank(true)
      }
      if (id === 'products' || id === 'add-product' || id === 'fuel_products') {
        setAddProduct(true)
      }
    }
    handleFocus({})
    window.addEventListener('boatpro-focus-field', handleFocus)
    return () => window.removeEventListener('boatpro-focus-field', handleFocus)
  }, [location.hash])

  const [tankForm, setTankForm] = useState({ stationId: '', code: '', fuel: '', capacity: '', stock: '', reorderAt: '', supplier: '', location: '', batch: '', expiresAt: '', temp: '', water: '' })
  const [editTankForm, setEditTankForm] = useState({ stationId: '', code: '', fuel: '', capacity: '', stock: '', reorderAt: '', supplier: '', location: '', batch: '', expiresAt: '', temp: '', water: '' })
  const [refillForm, setRefillForm] = useState({ qty: '', batch: '', supplier: '', window: '' })
  const [prodForm, setProdForm] = useState({ key: '', name: '', price: '', unit: 'gal', bulk: true, icon: '⛽', color: '#f59e0b' })
  const [supForm, setSupForm] = useState({ name: '', contactName: '', phone: '', email: '', leadTimeHours: '24', wholesalePrice: '' })

  const model = useMemo(() => {
    if (!inv.data) return null
    const products = inv.data.products.map((p) =>
      toFuelType(p, inv.data!.stockByProduct[p.key], inv.data!.soldByProduct[p.key] ?? 0),
    )
    const nameOf = (key: string) => products.find((p) => p.key === key)?.name ?? key
    return {
      products,
      byKey: new Map(products.map((p) => [p.key, p])),
      tanks: inv.data.tanks.map(toTank),
      suppliers: inv.data.suppliers.map((s) => toSupplier(s, nameOf)),
      rawSuppliers: inv.data.suppliers,
      totals: inv.data.totals,
      openOrders: inv.data.openOrders,
    }
  }, [inv.data])

  // The catalogue size is a plan limit (`maxFuelTypes`), so a refusal here is
  // an add-on prompt rather than a warning toast the operator can only dismiss.
  // Above the early returns: while inventory loads they skip everything after
  // them, and a hook that only runs once data arrives crashes the page.
  const createProduct = useLimitAwareAction(fuelApi.createProduct)

  if (inv.loading && !inv.data) return <LoadingState label={translatePortalText("Loading inventory…")} rows={5} />
  if (inv.error) return <ErrorState error={translatePortalText(inv.error)} onRetry={() => void inv.reload()} />
  if (!model) return null

  const fuelByKey = (k: string): FuelType =>
    model.byKey.get(k) ?? { id: k, key: k, name: k, icon: '⛽', color: '#94a3b8', price: 0, unit: 'gal', stock: 0, capacity: 0, sold: 0, bulk: true }

  const low = model.tanks.filter((t) => t.status === 'Low' || t.status === 'Critical')
  const currentStationName = localizedField<string>(currentStation, 'name', currentStation?.name)
  const totalStock = model.totals.stock
  const totalCap = model.totals.capacity
  const bulkProducts = model.products.filter((p) => p.bulk)
  const wholesale = model.rawSuppliers.find((s) => s.wholesalePrice)?.wholesalePrice ?? 0

  /** Refetch the inventory and the shared station snapshot. */
  const reloadInventory = async () => {
    await inv.reload()
    void refresh()
    window.dispatchEvent(new CustomEvent('boatpro-station-updated'))
  }

  /** Refetch, then announce. For flows that own their own toast, call
   *  `reloadInventory` directly instead of passing an empty message. */
  const after = async (msg: string) => {
    await reloadInventory()
    toast(translatePortalText(msg))
  }

  const syncSensors = async () => {
    setBusy(true)
    try {
      const res = await fuelApi.syncSensors()
      await inv.reload()
      toast(translatePortalText(res.data.updated ? `${res.data.updated} tanks updated from sensors` : 'Sensors polled — no new readings'))
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Sensor sync failed'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  const sendPurchaseOrders = async () => {
    if (!low.length) return
    setBusy(true)
    try {
      const res = await fuelApi.createPurchaseOrder({ tankIds: low.map((t) => t.id) })
      setPoOpen(false)
      await after(`${res.data.count} purchase order${res.data.count === 1 ? '' : 's'} sent`)
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not raise the purchase orders'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  const openFuelEditor = (f: FuelType) => {
    setEditFuel(f)
    setEditForm({ name: f.name, price: String(f.price), unit: f.unit as ProductUnit, icon: f.icon, color: f.color, bulk: f.bulk })
  }

  const saveFuelEdit = async () => {
    if (!editFuel) return
    const name = editForm.name.trim()
    if (!name) { toast(translatePortalText("Enter a fuel product name"), 'warn'); return }
    const price = parseFloat(editForm.price)
    if (isNaN(price) || price < 0) { toast(translatePortalText("Enter a valid price"), 'warn'); return }
    setBusy(true)
    try {
      await fuelApi.updateProduct(editFuel.id, {
        name,
        price,
        unit: editForm.unit,
        bulk: editForm.bulk,
        icon: editForm.icon || '⛽',
        color: editForm.color || '#f59e0b',
      })
      setEditFuel(null)
      await after(`${name} updated`)
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not update the fuel product'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  const deleteFuelProduct = () => {
    if (!editFuel) return
    const fuel = editFuel
    return confirmAndRun({
      title: translatePortalText(`Remove ${fuel.name} from your catalogue?`),
      body: 'Customers will no longer be able to order it. This cannot be undone.',
      confirmLabel: translatePortalText("Remove"),
      busyLabel: 'Removing...',
      danger: true,
      run: async () => {
        setBusy(true)
        try {
          await fuelApi.deleteProduct(fuel.id)
          setEditFuel(null)
          await reloadInventory()
        } finally { setBusy(false) }
      },
      success: translatePortalText(`${fuel.name} removed from your catalogue`),
      error: translatePortalText("Could not remove the fuel product. Please try again."),
    })
  }

  const submitAddProduct = async () => {
    const name = prodForm.name.trim()
    if (!name) { toast(translatePortalText("Enter a fuel product name"), 'warn'); return }
    const key = (prodForm.key.trim() || name).toLowerCase().replace(/[^a-z0-9_-]/g, '-')
    const price = parseFloat(prodForm.price)
    if (isNaN(price) || price < 0) { toast(translatePortalText("Enter a valid price"), 'warn'); return }

    setBusy(true)
    try {
      const created = await createProduct.run({
        key,
        name,
        price,
        unit: prodForm.unit as ProductUnit,
        bulk: prodForm.bulk,
        icon: prodForm.icon || '⛽',
        color: prodForm.color || '#f59e0b',
        isActive: true,
      })
      // `run` resolves undefined when it was refused and the add-on modal took
      // over — closing the form there would throw away the operator's input.
      if (!created) return
      setAddProduct(false)
      setProdForm({ key: '', name: '', price: '', unit: 'gal', bulk: true, icon: '⛽', color: '#f59e0b' })
      setTankForm(s => ({ ...s, fuel: key }))
      setAddTank(true)
      await after(`Fuel product "${name}" added to catalog`)
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not add fuel product'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  const submitAddSupplier = async () => {
    const name = supForm.name.trim()
    if (!name) { toast(translatePortalText("Enter supplier name"), 'warn'); return }
    setBusy(true)
    try {
      const res = await fuelApi.createSupplier({
        name,
        contactName: supForm.contactName.trim() || undefined,
        phone: supForm.phone.trim() || undefined,
        email: supForm.email.trim() || undefined,
        leadTimeHours: parseInt(supForm.leadTimeHours, 10) || 24,
        wholesalePrice: parseFloat(supForm.wholesalePrice) || undefined,
        isActive: true,
      })
      setAddSupplier(false)
      const newSupId = res.data.supplier._id
      setSupForm({ name: '', contactName: '', phone: '', email: '', leadTimeHours: '24', wholesalePrice: '' })
      setTankForm(s => ({ ...s, supplier: newSupId }))
      setAddTank(true)
      await after(`Supplier "${name}" added`)
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not add supplier'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  const exportLog = async (t: Tank) => {
    const f = fuelByKey(t.fuel)
    try {
      const { data } = await fuelApi.tankLog(t.id)
      const content = [
        `${translatePortalText('Tank history export')} — ${t.code}`,
        `${translatePortalText('Fuel:')} ${localizedField(f, 'name')}`,
        `${translatePortalText('Capacity:')} ${formatPortalNumber(t.capacity)} ${f.unit}`,
        `${translatePortalText('Current stock:')} ${formatPortalNumber(t.stock)} ${f.unit}`,
        `${translatePortalText('Status:')} ${translatePortalText(t.status)}`,
        `${translatePortalText('Batch:')} ${t.batch}`,
        `${translatePortalText('Supplier:')} ${t.supplier}`,
        `${translatePortalText('Last refill:')} ${t.lastRefill}`,
        `${translatePortalText('Expiry:')} ${t.expiry}`,
        `${translatePortalText('Temperature:')} ${formatPortalNumber(t.temp)}${translatePortalText('°C')}`,
        `${translatePortalText('Water content:')} ${formatPortalNumber(t.water)}%`,
        '',
        translatePortalText('Refills received'),
        ...(data.refills.length
          ? data.refills.map((r) => `  ${r.code} · ${formatPortalNumber(r.quantity)} ${f.unit} · ${r.supplierName ?? '—'} · ${translatePortalText(r.status)}`)
          : [`  ${translatePortalText('(none)')}`]),
        '',
        translatePortalText('Dispensing'),
        ...(data.dispenses.length
          ? data.dispenses.map((d) => `  ${d.code} · ${new Date(d.dispensedAt).toLocaleString(portalLocale())} · ${formatPortalNumber(d.quantity)} ${f.unit} · ${money(d.amount)}`)
          : [`  ${translatePortalText('(none)')}`]),
      ].join('\n')
      download(`${t.code}-history.txt`, content)
      toast(translatePortalText(`${t.code} history exported`), 'info')
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not export the tank log'), 'warn')
    }
  }

  const isUnapproved = !isAllStations && isStationUnapproved(currentStation)

  const openAddTankModal = () => {
    if (isUnapproved) {
      toast(translatePortalText(`Station "${currentStationName}" is awaiting platform admin approval. Adding tanks is locked.`), 'warn')
      return
    }
    const approvedStation = stationsList.find(s => s.approvalStatus === 'approved') || stationsList[0]
    const defaultStation = (!isAllStations && currentStationId && !isUnapproved) ? currentStationId : (approvedStation?.id || '')
    setTankForm({
      stationId: defaultStation,
      code: '',
      fuel: bulkProducts[0]?.key || '',
      capacity: '',
      stock: '',
      reorderAt: '',
      supplier: '',
      location: '',
      batch: '',
      expiresAt: '',
      temp: '',
      water: '',
    })
    setAddTank(true)
  }

  const submitAddTank = async () => {
    const code = tankForm.code.trim()
    if (!code) { toast(translatePortalText("Enter a Tank ID"), 'warn'); return }
    const productKey = tankForm.fuel || bulkProducts[0]?.key
    if (!productKey) { toast(translatePortalText("Add a bulk fuel product first"), 'warn'); return }
    const capacity = parseInt(tankForm.capacity, 10) || 0
    if (capacity <= 0) { toast(translatePortalText("Enter the tank capacity"), 'warn'); return }
    const stock = parseInt(tankForm.stock, 10) || 0
    if (stock > capacity) {
      toast(translatePortalText(`Current stock (${stock.toLocaleString(portalLocale())}) cannot exceed tank capacity (${capacity.toLocaleString(portalLocale())})`), 'warn')
      return
    }

    // Station is required - every tank must belong to a specific station
    const assignedStationId = tankForm.stationId || (!isAllStations ? currentStationId : undefined) || stationsList[0]?.id
    if (!assignedStationId) {
      toast(translatePortalText("Please select a station for this tank"), 'warn')
      return
    }

    setBusy(true)
    try {
      await fuelApi.createTank({
        code,
        stationId: assignedStationId,
        productKey,
        capacity,
        stock,
        reorderAt: parseInt(tankForm.reorderAt, 10) || 0,
        supplier: tankForm.supplier || undefined,
        location: tankForm.location.trim() || undefined,
        batch: tankForm.batch.trim() || undefined,
        expiresAt: tankForm.expiresAt || undefined,
        temperatureC: tankForm.temp ? parseFloat(tankForm.temp) : undefined,
        waterPct: tankForm.water ? parseFloat(tankForm.water) : undefined,
      })
      setAddTank(false)
      setTankForm({ stationId: '', code: '', fuel: '', capacity: '', stock: '', reorderAt: '', supplier: '', location: '', batch: '', expiresAt: '', temp: '', water: '' })
      await after(`Tank ${code} added to monitoring`)
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not add the tank'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  const submitRefill = async () => {
    if (!refill) return
    const qty = parseInt(refillForm.qty, 10) || 0
    if (qty <= 0) { toast(translatePortalText("Enter a valid quantity"), 'warn'); return }
    const maxRefill = Math.max(0, refill.capacity - refill.stock)
    if (qty > maxRefill) {
      toast(translatePortalText(`Refill quantity (${qty.toLocaleString(portalLocale())}) cannot exceed remaining tank capacity (${maxRefill.toLocaleString(portalLocale())})`), 'warn')
      return
    }

    setBusy(true)
    try {
      await fuelApi.createPurchaseOrder({
        tankId: refill.id,
        quantity: qty,
        supplierId: refillForm.supplier || refill.supplierId,
        batch: refillForm.batch.trim() || undefined,
        deliveryWindow: refillForm.window.trim() || undefined,
      })
      const code = refill.code
      setRefill(null)
      setRefillForm({ qty: '', batch: '', supplier: '', window: '' })
      await after(`${qty.toLocaleString(portalLocale())} refill ordered for ${code}`)
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not order the refill'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  const openTankEditor = (t: Tank) => {
    setEditTank(t)
    setEditTankForm({
      stationId: t.stationId || (!isAllStations && currentStationId ? currentStationId : (stationsList[0]?.id || '')),
      code: t.code,
      fuel: t.fuel,
      capacity: String(t.capacity),
      stock: String(t.stock),
      reorderAt: String(t.reorderAt),
      supplier: t.supplierId ?? '',
      location: t.location ?? '',
      batch: t.batch ?? '',
      expiresAt: t.expiry && t.expiry !== '—' ? t.expiry : '',
      temp: String(t.temp ?? 30),
      water: String(t.water ?? 0),
    })
  }

  const submitEditTank = async () => {
    if (!editTank) return
    const code = editTankForm.code.trim()
    if (!code) { toast(translatePortalText("Enter a Tank ID"), 'warn'); return }
    const capacity = parseInt(editTankForm.capacity, 10) || 0
    if (capacity <= 0) { toast(translatePortalText("Enter the tank capacity"), 'warn'); return }
    const stock = parseInt(editTankForm.stock, 10) || 0
    if (stock > capacity) {
      toast(translatePortalText(`Current stock (${stock.toLocaleString(portalLocale())}) cannot exceed tank capacity (${capacity.toLocaleString(portalLocale())})`), 'warn')
      return
    }

    setBusy(true)
    try {
      await fuelApi.updateTank(editTank.id, {
        code,
        stationId: editTankForm.stationId || undefined,
        productKey: editTankForm.fuel || editTank.fuel,
        capacity,
        stock,
        reorderAt: parseInt(editTankForm.reorderAt, 10) || 0,
        supplier: editTankForm.supplier || undefined,
        location: editTankForm.location.trim() || undefined,
        batch: editTankForm.batch.trim() || undefined,
        expiresAt: editTankForm.expiresAt || undefined,
        temperatureC: editTankForm.temp ? parseFloat(editTankForm.temp) : undefined,
        waterPct: editTankForm.water ? parseFloat(editTankForm.water) : undefined,
      })
      setEditTank(null)
      await after(`Tank ${code} updated`)
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not update the tank'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  const submitDeleteTank = () => {
    if (!editTank) return
    const tank = editTank
    return confirmAndRun({
      title: translatePortalText(`Deactivate tank ${tank.code}?`),
      body: 'It will stop accepting deliveries and stop counting towards available stock.',
      confirmLabel: translatePortalText("Deactivate"),
      busyLabel: 'Deactivating...',
      danger: true,
      run: async () => {
        setBusy(true)
        try {
          await fuelApi.deleteTank(tank.id)
          setEditTank(null)
          await reloadInventory()
        } finally { setBusy(false) }
      },
      success: translatePortalText(`Tank ${tank.code} deactivated successfully`),
      error: translatePortalText("Could not deactivate the tank. Please try again."),
    })
  }

  /** Books an already-raised order into its tank. */
  const receiveOrder = async (id: string, code: string) => {
    setBusy(true)
    try {
      await fuelApi.receivePurchaseOrder(id)
      await after(`${code} received into stock`)
    } catch (e) {
      toast(translatePortalText(e instanceof Error ? e.message : 'Could not receive the order'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  const openRefill = (t: Tank) => {
    setRefill(t)
    setRefillForm({ qty: String(Math.max(0, t.capacity - t.stock)), batch: '', supplier: t.supplierId ?? '', window: '' })
  }

  return (
    <div className="space-y-5">
      <FuelHeader title={translatePortalText("Fuel Inventory Management")}
        sub={translatePortalText(currentStation ? `📍 ${currentStationName} — tanks, stock levels, batches, suppliers, expiry & reorder automation` : 'Tanks, stock levels, batches, suppliers, expiry & reorder automation')}
        icon={<span className="text-2xl">🛢️</span>}
        actions={<>
          <LoadingButton loading={busy} disabled={isUnapproved} className="btn-ghost" onClick={syncSensors} icon={<RefreshCw size={15} />}>{translatePortalText("Sync sensors")}</LoadingButton>
          <button
            className={`btn-fuel ${isUnapproved ? 'opacity-60 cursor-not-allowed' : ''}`}
            disabled={isUnapproved}
            title={isUnapproved ? translatePortalText('Station location is awaiting admin approval') : undefined}
            onClick={openAddTankModal}
          >
            <Plus size={15} />{translatePortalText(" Add fuel tank")}</button>
        </>} />

      {/* Station Approval Notice when unapproved */}
      <StationApprovalNotice />

      {/* low stock banner */}
      {low.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3.5">
          <span className="text-2xl">📉</span>
          <p className="flex-1 text-sm font-bold text-amber-800">
            {low.length} {translatePortalText(low.length === 1 ? 'tank below reorder point:' : 'tanks below reorder point:')} {low.map(t => `${t.code} (${fuelByKey(t.fuel).name})`).join(', ')}.
          </p>
          <button className="btn-fuel !py-1.5 !px-3 text-xs" onClick={() => setPoOpen(true)}>{translatePortalText("Create purchase orders")}</button>
        </motion.div>
      )}

      {/* orders awaiting delivery */}
      {model.openOrders.length > 0 && (
        <Section title={translatePortalText("Refills on order")} sub={translatePortalText("Raised with suppliers and awaiting delivery")}>
          <div className="space-y-2">
            {model.openOrders.map(o => {
              const f = fuelByKey(o.productKey)
              const tankCode = typeof o.tank === 'object' && o.tank ? o.tank.code : '—'
              return (
                <div key={o._id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-sand p-3 text-xs">
                  <div>
                    <p className="font-bold text-deep-900">{o.code} · {f.icon} {o.quantity.toLocaleString(portalLocale())} {f.unit} → {tankCode}</p>
                    <p className="text-slate-400">
                      {o.supplierName ?? 'Supplier'}
                      {o.deliveryWindow ? ` · ${o.deliveryWindow}` : translatePortalText("")}
                      {o.expectedAt ? ` · ${translatePortalText("expected ")}${new Date(o.expectedAt).toLocaleDateString(portalLocale(), { month: 'short', day: '2-digit' })}` : translatePortalText("")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {o.totalCost != null && <b className="text-deep-800">{money(o.totalCost)}</b>}
                    <button className="btn-fuel !py-1.5 !px-3 text-xs" disabled={busy} onClick={() => receiveOrder(o._id, o.code)}>{translatePortalText("Receive")}</button>
                  </div>
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {/* fuel catalog */}
      <Section title={translatePortalText("Fuel types & catalog")} sub={translatePortalText("All products offered — tap a card to edit price and availability")}
        actions={<button className={`btn-fuel !py-1.5 !px-3 text-xs ${isUnapproved ? 'opacity-60 cursor-not-allowed' : ''}`} disabled={isUnapproved} onClick={() => {
          if (isUnapproved) { toast(translatePortalText('Station is awaiting admin approval'), 'warn'); return }
          setAddProduct(true)
        }}><Plus size={13} />{translatePortalText(" Add fuel type")}</button>}>
        {model.products.length === 0 ? (
          <p className="rounded-2xl bg-sand px-4 py-10 text-center text-xs font-semibold text-slate-400">{translatePortalText("No products in your catalogue yet. Tap ")}<button type="button" className="text-amber-600 font-bold underline" onClick={() => {
              if (isUnapproved) { toast(translatePortalText("Station is awaiting admin approval"), 'warn'); return }
              setAddProduct(true)
            }}>{translatePortalText("Add fuel type")}</button>{translatePortalText(" to create one.")}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {model.products.map((f, i) => (
              <motion.button key={f.key} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                whileHover={{ y: -3 }} onClick={() => openFuelEditor(f)}
                className="card card-hover relative overflow-hidden p-3.5 text-left">
                <span className="text-2xl">{f.icon}</span>
                <p className="mt-2 text-[12px] font-extrabold leading-tight text-deep-900">{f.name}</p>
                <p className="mt-1 font-display text-lg font-extrabold" style={{ color: f.color }}>
                  {money(f.price)}<span className="text-[10px] font-bold text-slate-400">/{f.unit}</span>
                </p>
                {f.capacity > 0
                  ? <p className="text-[10px] font-semibold text-slate-400">{Math.round(f.stock / f.capacity * 100)}{translatePortalText("% in stock")}</p>
                  : <p className="text-[10px] font-semibold text-slate-400">{f.bulk ? translatePortalText("No tank assigned") : translatePortalText("Retail item")}</p>}
                <span className="absolute -bottom-4 -end-4 h-14 w-14 rounded-full opacity-15" style={{ background: f.color }} />
              </motion.button>
            ))}
          </div>
        )}
      </Section>

      {/* tanks detail */}
      <Section
        title={translatePortalText(isAllStations ? 'Storage tanks (All Stations)' : `Storage tanks — ${currentStationName || translatePortalText('Selected Station')}`)}
        sub={translatePortalText(`${totalStock.toLocaleString(portalLocale())} of ${totalCap.toLocaleString(portalLocale())} stored · ${model.tanks.length} tank${model.tanks.length === 1 ? '' : 's'} monitored live`)}
      >
        {model.tanks.length === 0 ? (
          <div className="rounded-2xl bg-sand px-4 py-10 text-center">
            <p className="text-xs font-semibold text-slate-500">
              {isUnapproved
                ? translatePortalText(`Station "${currentStationName}" is currently awaiting platform admin approval. Tank installations will be enabled once approved.`)
                : isAllStations
                ? translatePortalText("No tanks registered yet — click \"+ Add fuel tank\" to create your first tank.")
                : translatePortalText(`No tanks found for ${currentStationName || translatePortalText('this location')} — click "+ Add fuel tank" to install one here.`)}
            </p>
            {!isUnapproved && (
              <button
                type="button"
                className="btn-fuel mt-3 inline-flex !py-1.5 !px-3 text-xs"
                onClick={openAddTankModal}
              >
                <Plus size={14} />{translatePortalText(" Add fuel tank here")}</button>
            )}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {model.tanks.map((t, i) => {
              const f = fuelByKey(t.fuel)
              const pct = t.capacity ? Math.min(100, Math.max(0, Math.round((t.stock / t.capacity) * 100))) : 0
              return (
                <motion.div key={t.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                  className="card card-hover p-4">
                  <div className="flex items-start gap-4">
                    <div className="w-24 shrink-0"><TankGauge pct={pct} color={f.color} height={130} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-display text-[15px] font-extrabold text-deep-900">{t.code} · {f.icon} {f.name}</p>
                        <FBadge dot={t.status !== 'Healthy'}>{t.status}</FBadge>
                      </div>
                      {t.stationName && (
                        <div className="mt-1 inline-flex items-center gap-1 rounded bg-ocean-50 px-2 py-0.5 text-[11px] font-semibold text-ocean-700">
                          <span>📍</span> {t.stationName}
                        </div>
                      )}
                      <p className="mt-1 text-xs text-slate-400">{t.stock.toLocaleString(portalLocale())} / {t.capacity.toLocaleString(portalLocale())} {f.unit}{translatePortalText(" · reorder at ")}{t.reorderAt.toLocaleString(portalLocale())}</p>
                      <div className="mt-2.5 grid grid-cols-2 gap-1.5 text-[11px]">
                        <span className="flex items-center gap-1.5 rounded-lg bg-sand px-2 py-1.5"><PackageOpen size={12} className="text-amber-500" />{translatePortalText(" Batch ")}<b className="ms-auto">{t.batch}</b></span>
                        <span className="flex items-center gap-1.5 rounded-lg bg-sand px-2 py-1.5">{translatePortalText("⏳ Expiry ")}<b className="ms-auto">{t.expiry}</b></span>
                        <span className="flex items-center gap-1.5 rounded-lg bg-sand px-2 py-1.5"><Thermometer size={12} className="text-amber-500" />{translatePortalText(" Temp ")}<b className="ms-auto">{t.temp}{translatePortalText("°C")}</b></span>
                        <span className="flex items-center gap-1.5 rounded-lg bg-sand px-2 py-1.5"><Droplet size={12} className="text-amber-500" />{translatePortalText(" Water ")}<b className="ms-auto">{t.water}%</b></span>
                      </div>
                      <div className="mt-2.5 flex gap-2">
                        <button className="btn-fuel !py-1.5 !px-3 text-xs flex-1 !justify-center" onClick={() => openRefill(t)}>{translatePortalText("Refill")}</button>
                        <button className="btn-ghost !py-1.5 !px-3 text-xs flex items-center gap-1" onClick={() => openTankEditor(t)}><Pencil size={12} />{translatePortalText(" Edit")}</button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
      </Section>

      {/* edit tank modal */}
      <Modal open={!!editTank} onClose={() => setEditTank(null)} title={translatePortalText(`✏️ Edit tank ${editTank?.code ?? ''}`)}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="label">{translatePortalText("Station / Sub-station Location")}</label>
              <select
                className="input font-medium"
                value={editTankForm.stationId}
                onChange={e => setEditTankForm(s => ({ ...s, stationId: e.target.value }))}
              >
                {stationsList.map((st) => (
                  <option key={st.id} value={st.id} disabled={st.approvalStatus && st.approvalStatus !== 'approved'}>
                    {st.approvalStatus === 'pending' ? translatePortalText("⏳ [Pending Approval] ") : st.approvalStatus === 'rejected' ? translatePortalText("❌ [Rejected] ") : translatePortalText("📍 ")}
                    {localizedField<string>(st, 'name', st.name)} {st.city ? `(${localizedField<string>(st, 'city', st.city)})` : translatePortalText("")} {st.approvalStatus && st.approvalStatus !== 'approved' ? translatePortalText("(Locked)") : translatePortalText("")}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-400">{translatePortalText("Reassign which station/sub-station this fuel tank is located at.")}</p>
            </div>
            <div>
              <label className="label">{translatePortalText("Tank ID")}</label>
              <input className="input" value={editTankForm.code} onChange={e => setEditTankForm(s => ({ ...s, code: e.target.value }))} />
            </div>
            <div>
              <label className="label">{translatePortalText("Fuel type")}</label>
              <select className="input" value={editTankForm.fuel} onChange={e => setEditTankForm(s => ({ ...s, fuel: e.target.value }))}>
                {bulkProducts.map(f => <option key={f.key} value={f.key}>{f.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">{translatePortalText("Capacity")}</label>
              <input className="input" type="number" value={editTankForm.capacity} onChange={e => setEditTankForm(s => ({ ...s, capacity: e.target.value }))} />
            </div>
            <div>
              <label className="label">{translatePortalText("Current stock (Max: ")}{editTankForm.capacity || '0'})</label>
              <input className="input" type="number" value={editTankForm.stock} onChange={e => setEditTankForm(s => ({ ...s, stock: e.target.value }))} />
            </div>
            <div>
              <label className="label">{translatePortalText("Reorder point")}</label>
              <input className="input" type="number" value={editTankForm.reorderAt} onChange={e => setEditTankForm(s => ({ ...s, reorderAt: e.target.value }))} />
            </div>
            <div>
              <label className="label">{translatePortalText("Supplier")}</label>
              <select className="input" value={editTankForm.supplier} onChange={e => setEditTankForm(s => ({ ...s, supplier: e.target.value }))}>
                <option value="">{translatePortalText("Select…")}</option>
                {model.rawSuppliers.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">{translatePortalText("Batch number")}</label>
              <input className="input" value={editTankForm.batch} onChange={e => setEditTankForm(s => ({ ...s, batch: e.target.value }))} />
            </div>
            <div>
              <label className="label">{translatePortalText("Expiry date")}</label>
              <input className="input" type="date" value={editTankForm.expiresAt} onChange={e => setEditTankForm(s => ({ ...s, expiresAt: e.target.value }))} />
            </div>
            <div>
              <label className="label">{translatePortalText("Temperature (°C)")}</label>
              <input className="input" type="number" step="0.1" value={editTankForm.temp} onChange={e => setEditTankForm(s => ({ ...s, temp: e.target.value }))} />
            </div>
            <div>
              <label className="label">{translatePortalText("Water content (%)")}</label>
              <input className="input" type="number" step="0.1" value={editTankForm.water} onChange={e => setEditTankForm(s => ({ ...s, water: e.target.value }))} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 pt-2">
            <button className="btn-ghost text-red-600 hover:bg-red-50 flex items-center gap-1.5 text-xs font-bold" disabled={busy} onClick={submitDeleteTank}>
              <Trash2 size={14} />{translatePortalText(" Remove tank")}</button>
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={() => setEditTank(null)}>{translatePortalText("Cancel")}</button>
              <LoadingButton loading={busy} className="btn-fuel" onClick={submitEditTank}>{translatePortalText("Save changes")}</LoadingButton>
            </div>
          </div>
        </div>
      </Modal>

      {/* add tank modal */}
      <Modal open={addTank} onClose={() => setAddTank(false)} title={translatePortalText("🛢️ Add fuel tank")}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="label">{translatePortalText("Station / Sub-station Location")}</label>
              <select
                className="input font-medium"
                value={tankForm.stationId}
                onChange={e => setTankForm(s => ({ ...s, stationId: e.target.value }))}
              >
                {stationsList.map((st) => (
                  <option key={st.id} value={st.id} disabled={st.approvalStatus && st.approvalStatus !== 'approved'}>
                    {st.approvalStatus === 'pending' ? translatePortalText("⏳ [Pending Approval] ") : st.approvalStatus === 'rejected' ? translatePortalText("❌ [Rejected] ") : translatePortalText("📍 ")}
                    {localizedField<string>(st, 'name', st.name)} {st.city ? `(${localizedField<string>(st, 'city', st.city)})` : translatePortalText("")} {st.approvalStatus && st.approvalStatus !== 'approved' ? translatePortalText("(Locked)") : translatePortalText("")}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-400">{translatePortalText("Select which station or sub-station this fuel tank is installed at.")}</p>
            </div>
            <div><label className="label">{translatePortalText("Tank ID")}</label>
              <input className="input" placeholder={translatePortalText("TK-08")} value={tankForm.code} onChange={e => setTankForm(s => ({ ...s, code: e.target.value }))} /></div>
            <div><label className="label">{translatePortalText("Fuel type")}</label>
              <select className="input" value={tankForm.fuel} onChange={e => setTankForm(s => ({ ...s, fuel: e.target.value }))}>
                <option value="">{translatePortalText("Select…")}</option>
                {bulkProducts.map(f => <option key={f.key} value={f.key}>{f.name}</option>)}
              </select>
              {bulkProducts.length === 0 && (
                <div className="mt-1 flex items-center justify-between text-[11px] font-semibold text-amber-600">
                  <span>{translatePortalText("No bulk fuel types found")}</span>
                  <button type="button" className="font-bold underline text-amber-700 hover:text-amber-900" onClick={() => { setAddTank(false); setAddProduct(true); }}>{translatePortalText("+ Add fuel type")}</button>
                </div>
              )}
            </div>
            <div><label className="label">{translatePortalText("Capacity")}</label>
              <input className="input" type="number" placeholder="10000" value={tankForm.capacity} onChange={e => setTankForm(s => ({ ...s, capacity: e.target.value }))} /></div>
            <div><label className="label">{translatePortalText("Current stock")}</label>
              <input className="input" type="number" placeholder="0" value={tankForm.stock} onChange={e => setTankForm(s => ({ ...s, stock: e.target.value }))} /></div>
            <div><label className="label">{translatePortalText("Reorder point")}</label>
              <input className="input" type="number" placeholder="3000" value={tankForm.reorderAt} onChange={e => setTankForm(s => ({ ...s, reorderAt: e.target.value }))} /></div>
            <div><label className="label">{translatePortalText("Supplier")}</label>
              <select className="input" value={tankForm.supplier} onChange={e => setTankForm(s => ({ ...s, supplier: e.target.value }))}>
                <option value="">{translatePortalText("Select…")}</option>
                {model.rawSuppliers.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
              </select>
              <div className="mt-1 flex items-center justify-between text-[11px] font-semibold text-amber-600">
                <span>{model.rawSuppliers.length === 0 ? translatePortalText("No registered suppliers") : translatePortalText("")}</span>
                <button type="button" className="font-bold underline text-amber-700 hover:text-amber-900 ms-auto" onClick={() => { setAddTank(false); setAddSupplier(true); }}>{translatePortalText("+ Add supplier")}</button>
              </div>
            </div>
            <div className="col-span-2"><label className="label">{translatePortalText("Location")}</label>
              <input className="input" placeholder={translatePortalText("Fuel Pier · Bay 3")} value={tankForm.location} onChange={e => setTankForm(s => ({ ...s, location: e.target.value }))} /></div>
            <div>
              <label className="label">{translatePortalText("Batch Number ")}<span className="font-normal text-slate-400">{translatePortalText("(optional)")}</span></label>
              <input className="input" placeholder={translatePortalText("e.g. BD-2026-X9")} value={tankForm.batch} onChange={e => setTankForm(s => ({ ...s, batch: e.target.value }))} />
            </div>
            <div>
              <label className="label">{translatePortalText("Expiry Date ")}<span className="font-normal text-slate-400">{translatePortalText("(optional)")}</span></label>
              <input className="input" type="date" value={tankForm.expiresAt} onChange={e => setTankForm(s => ({ ...s, expiresAt: e.target.value }))} />
            </div>
            <div>
              <label className="label">{translatePortalText("Initial Temp (°C) ")}<span className="font-normal text-slate-400">{translatePortalText("(optional)")}</span></label>
              <input className="input" type="number" placeholder="22" value={tankForm.temp} onChange={e => setTankForm(s => ({ ...s, temp: e.target.value }))} />
            </div>
            <div>
              <label className="label">{translatePortalText("Initial Water (%) ")}<span className="font-normal text-slate-400">{translatePortalText("(optional)")}</span></label>
              <input className="input" type="number" step="0.1" placeholder="0.1" value={tankForm.water} onChange={e => setTankForm(s => ({ ...s, water: e.target.value }))} />
            </div>
          </div>
          <LoadingButton loading={busy} className="btn-fuel w-full !justify-center !py-2.5" onClick={submitAddTank}>{translatePortalText("Add tank")}</LoadingButton>
        </div>
      </Modal>

      {/* add fuel product modal */}
      <Modal open={addProduct} onClose={() => setAddProduct(false)} title={translatePortalText("⛽ Add Fuel Type / Product")}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="label">{translatePortalText("Product Name")}</label>
              <input className="input" placeholder={translatePortalText("e.g. Ultra-Low Sulfur Diesel, Premium 95, DEF")} value={prodForm.name}
                onChange={e => {
                  const name = e.target.value
                  setProdForm(s => ({
                    ...s,
                    name,
                    key: s.key || name.toLowerCase().replace(/[^a-z0-9_-]/g, '-')
                  }))
                }} />
            </div>
            <div>
              <label className="label">{translatePortalText("Product Key (identifier)")}</label>
              <input className="input" placeholder={translatePortalText("e.g. diesel")} value={prodForm.key}
                onChange={e => setProdForm(s => ({ ...s, key: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-') }))} />
            </div>
            <div>
              <label className="label">{translatePortalText("Price ($)")}</label>
              <input className="input" type="number" step="0.01" placeholder={translatePortalText("e.g. 3.85")} value={prodForm.price}
                onChange={e => setProdForm(s => ({ ...s, price: e.target.value }))} />
            </div>
            <div>
              <label className="label">{translatePortalText("Unit")}</label>
              <select className="input" value={prodForm.unit} onChange={e => setProdForm(s => ({ ...s, unit: e.target.value }))}>
                <option value="gal">{translatePortalText("gal (Gallons)")}</option>
                <option value="L">{translatePortalText("L (Liters)")}</option>
                <option value="kg">{translatePortalText("kg (Kilograms)")}</option>
                <option value="kWh">{translatePortalText("kWh (Kilowatt Hours)")}</option>
                <option value="qt">{translatePortalText("qt (Quarts)")}</option>
              </select>
            </div>
            <div>
              <label className="label">{translatePortalText("Icon & Color")}</label>
              <div className="flex gap-2">
                <input className="input !w-16 text-center text-lg" value={prodForm.icon} onChange={e => setProdForm(s => ({ ...s, icon: e.target.value }))} placeholder="⛽" />
                <input type="color" className="h-10 w-full cursor-pointer rounded-xl border border-slate-200 bg-sand p-1" value={prodForm.color} onChange={e => setProdForm(s => ({ ...s, color: e.target.value }))} />
              </div>
            </div>
            <div className="col-span-2">
              <label className="flex items-center gap-2 text-xs font-bold text-deep-900 cursor-pointer pt-1">
                <input type="checkbox" checked={prodForm.bulk} onChange={e => setProdForm(s => ({ ...s, bulk: e.target.checked }))} className="rounded border-slate-300 text-amber-500 focus:ring-amber-400" />
                <span>{translatePortalText("Bulk fuel product (stored in storage tanks)")}</span>
              </label>
              <p className="mt-0.5 text-[11px] text-slate-400 ps-6">{translatePortalText("When checked, this fuel type will be available to select for storage tanks.")}</p>
            </div>
          </div>
          <LoadingButton loading={busy} className="btn-fuel w-full !justify-center !py-2.5" onClick={submitAddProduct}>{translatePortalText("Add fuel type")}</LoadingButton>
        </div>
      </Modal>

      {/* add supplier modal */}
      <Modal open={addSupplier} onClose={() => setAddSupplier(false)} title={translatePortalText("🏢 Add Fuel Supplier")}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="label">{translatePortalText("Supplier Name")}</label>
              <input className="input" placeholder={translatePortalText("e.g. Aramco Direct, Shell Marine, ADNOC")} value={supForm.name}
                onChange={e => setSupForm(s => ({ ...s, name: e.target.value }))} />
            </div>
            <div>
              <label className="label">{translatePortalText("Contact Name")}</label>
              <input className="input" placeholder={translatePortalText("e.g. John Miller")} value={supForm.contactName}
                onChange={e => setSupForm(s => ({ ...s, contactName: e.target.value }))} />
            </div>
            <div>
              <label className="label">{translatePortalText("Phone")}</label>
              <input className="input" placeholder={translatePortalText("e.g. +966 50 123 4567")} value={supForm.phone}
                onChange={e => setSupForm(s => ({ ...s, phone: e.target.value }))} />
            </div>
            <div>
              <label className="label">{translatePortalText("Email")}</label>
              <input className="input" type="email" placeholder={translatePortalText("orders@supplier.com")} value={supForm.email}
                onChange={e => setSupForm(s => ({ ...s, email: e.target.value }))} />
            </div>
            <div>
              <label className="label">{translatePortalText("Lead Time (Hours)")}</label>
              <input className="input" type="number" placeholder="24" value={supForm.leadTimeHours}
                onChange={e => setSupForm(s => ({ ...s, leadTimeHours: e.target.value }))} />
            </div>
          </div>
          <LoadingButton loading={busy} className="btn-fuel w-full !justify-center !py-2.5" onClick={submitAddSupplier}>{translatePortalText("Add supplier")}</LoadingButton>
        </div>
      </Modal>

      {/* refill modal */}
      <Modal open={!!refill} onClose={() => setRefill(null)} title={translatePortalText(`⛽ Refill ${refill?.code ?? ''}`)}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">{translatePortalText("Quantity (Max: ")}{refill ? Math.max(0, refill.capacity - refill.stock).toLocaleString(portalLocale()) : 0} {refill ? fuelByKey(refill.fuel).unit : translatePortalText("")})</label>
              <input className="input" type="number" placeholder={translatePortalText("Quantity")} value={refillForm.qty} onChange={e => setRefillForm(s => ({ ...s, qty: e.target.value }))} /></div>
            <div><label className="label">{translatePortalText("Batch number")}</label>
              <input className="input" placeholder={translatePortalText("BD-2620-A")} value={refillForm.batch} onChange={e => setRefillForm(s => ({ ...s, batch: e.target.value }))} /></div>
            <div><label className="label">{translatePortalText("Supplier")}</label>
              <select className="input" value={refillForm.supplier} onChange={e => setRefillForm(s => ({ ...s, supplier: e.target.value }))}>
                <option value="">{translatePortalText("Tank default")}</option>
                {model.rawSuppliers.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
              </select></div>
            <div><label className="label">{translatePortalText("Delivery window")}</label>
              <input className="input" placeholder={translatePortalText("Tomorrow 06:00–08:00")} value={refillForm.window} onChange={e => setRefillForm(s => ({ ...s, window: e.target.value }))} /></div>
          </div>
          {wholesale > 0 && (
            <div className="rounded-xl bg-sand p-3 text-xs text-slate-500">{translatePortalText("Estimated cost at current wholesale index: ")}<b className="text-deep-900">{money((parseInt(refillForm.qty, 10) || 0) * wholesale)}</b></div>
          )}
          <LoadingButton loading={busy} className="btn-fuel w-full !justify-center !py-2.5" onClick={submitRefill}>{translatePortalText("Order refill")}</LoadingButton>
        </div>
      </Modal>

      {/* create purchase orders modal */}
      <Modal open={poOpen} onClose={() => setPoOpen(false)} title={translatePortalText("📦 Create purchase orders")}>
        <div className="space-y-4">
          <p className="text-xs text-slate-500">{low.length} {translatePortalText(low.length === 1 ? 'tank below reorder point:' : 'tanks below reorder point:')}</p>
          <div className="space-y-2">
            {low.map(t => {
              const f = fuelByKey(t.fuel)
              const sup = model.rawSuppliers.find(s => s._id === t.supplierId)
              return (
                <div key={t.id} className="flex items-center justify-between gap-3 rounded-xl bg-sand p-3 text-xs">
                  <div>
                    <p className="font-bold text-deep-900">{t.code} · {f.icon} {f.name}</p>
                    <p className="text-slate-400">{t.stock.toLocaleString(portalLocale())} / {t.capacity.toLocaleString(portalLocale())} {f.unit}{translatePortalText(" · reorder at ")}{t.reorderAt.toLocaleString(portalLocale())}</p>
                  </div>
                  <div className="text-right text-slate-400">
                    <p className="font-semibold text-deep-800">{t.supplier}</p>
                    {sup && <p>{translatePortalText("Lead time ")}{leadTimeLabel(sup.leadTimeHours)}</p>}
                  </div>
                </div>
              )
            })}
          </div>
          <LoadingButton loading={busy} className="btn-fuel w-full !justify-center !py-2.5" onClick={sendPurchaseOrders}>{translatePortalText("Send purchase orders")}</LoadingButton>
        </div>
      </Modal>

      {/* edit fuel product modal */}
      <Modal open={!!editFuel} onClose={() => setEditFuel(null)} title={translatePortalText(`${editFuel?.icon ?? ''} Edit ${editFuel?.name ?? ''}`)}>
        {editFuel && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="label">{translatePortalText("Product Name")}</label>
                <input className="input" value={editForm.name} onChange={e => setEditForm(s => ({ ...s, name: e.target.value }))} />
              </div>
              <div>
                <label className="label">{translatePortalText("Product Key (identifier)")}</label>
                <input className="input bg-sand text-slate-400" value={editFuel.key} disabled readOnly />
              </div>
              <div>
                <label className="label">{translatePortalText("Price ($)")}</label>
                <input className="input" type="number" step="0.01" value={editForm.price} onChange={e => setEditForm(s => ({ ...s, price: e.target.value }))} />
              </div>
              <div>
                <label className="label">{translatePortalText("Unit")}</label>
                <select className="input" value={editForm.unit} onChange={e => setEditForm(s => ({ ...s, unit: e.target.value as ProductUnit }))}>
                  <option value="gal">{translatePortalText("gal (Gallons)")}</option>
                  <option value="L">{translatePortalText("L (Liters)")}</option>
                  <option value="kg">{translatePortalText("kg (Kilograms)")}</option>
                  <option value="kWh">{translatePortalText("kWh (Kilowatt Hours)")}</option>
                  <option value="qt">{translatePortalText("qt (Quarts)")}</option>
                </select>
              </div>
              <div>
                <label className="label">{translatePortalText("Icon & Color")}</label>
                <div className="flex gap-2">
                  <input className="input !w-16 text-center text-lg" value={editForm.icon} onChange={e => setEditForm(s => ({ ...s, icon: e.target.value }))} placeholder="⛽" />
                  <input type="color" className="h-10 w-full cursor-pointer rounded-xl border border-slate-200 bg-sand p-1" value={editForm.color} onChange={e => setEditForm(s => ({ ...s, color: e.target.value }))} />
                </div>
              </div>
              <div className="col-span-2">
                <label className="flex items-center gap-2 text-xs font-bold text-deep-900 cursor-pointer pt-1">
                  <input type="checkbox" checked={editForm.bulk} onChange={e => setEditForm(s => ({ ...s, bulk: e.target.checked }))} className="rounded border-slate-300 text-amber-500 focus:ring-amber-400" />
                  <span>{translatePortalText("Bulk fuel product (stored in storage tanks)")}</span>
                </label>
                <p className="mt-0.5 text-[11px] text-slate-400 ps-6">{translatePortalText("When checked, this fuel type will be available to select for storage tanks.")}</p>
              </div>
            </div>
            {editFuel.capacity > 0 && (
              <p className="text-xs text-slate-400">{translatePortalText("Current stock: ")}{editFuel.stock.toLocaleString(portalLocale())} / {editFuel.capacity.toLocaleString(portalLocale())} {editFuel.unit}</p>
            )}
            <div className="flex gap-2">
              <LoadingButton loading={busy} className="btn-fuel flex-1 !justify-center !py-2.5" onClick={saveFuelEdit}>{translatePortalText("Save changes")}</LoadingButton>
              <button type="button" disabled={busy} className="btn-ghost !py-2.5 !px-4 text-xs text-red-500" onClick={deleteFuelProduct}>{translatePortalText("Delete")}</button>
            </div>
          </div>
        )}
      </Modal>

      {createProduct.modal}
    </div>
  )
}
