/**
 * PrivacyPage — Política de Privacidad de UMPI.
 * Copy is the client's literal legal text — do NOT translate or edit.
 */
import LegalPageLayout from '../components/LegalPageLayout'
import { LEGAL_VERSION_LABEL } from '../legalContent'

export default function PrivacyPage() {
  return (
    <LegalPageLayout
      title="Política de Privacidad de UMPI."
      updatedAt={`Última actualización: ${LEGAL_VERSION_LABEL}`}
    >
      <section>
        <h2 className="font-header-md text-header-md text-text-deep mb-2">
          Información recopilada
        </h2>
        <p className="text-text-secondary leading-relaxed">
          UMPI puede recopilar:
        </p>
        <ul className="list-disc pl-5 text-text-secondary leading-relaxed">
          <li>Nombre.</li>
          <li>Correo electrónico.</li>
          <li>Número de teléfono.</li>
          <li>Ciudad.</li>
          <li>Ubicación (solo la ciudad que el usuario selecciona manualmente; no se recopila ubicación automática).</li>
          <li>Fotografías de publicaciones.</li>
          <li>Descripción de los avisos.</li>
          <li>Dirección IP.</li>
          <li>Datos técnicos del dispositivo.</li>
          <li>Información de uso de la plataforma.</li>
        </ul>
      </section>

      <section>
        <h2 className="font-header-md text-header-md text-text-deep mb-2">
          Finalidad
        </h2>
        <p className="text-text-secondary leading-relaxed">
          Los datos serán utilizados para:
        </p>
        <ul className="list-disc pl-5 text-text-secondary leading-relaxed">
          <li>Crear la cuenta.</li>
          <li>Publicar anuncios.</li>
          <li>Mostrar publicaciones.</li>
          <li>Contactar usuarios.</li>
          <li>Brindar soporte.</li>
          <li>Mejorar la plataforma.</li>
          <li>Detectar fraudes.</li>
          <li>Cumplir obligaciones legales.</li>
        </ul>
      </section>

      <section>
        <h2 className="font-header-md text-header-md text-text-deep mb-2">
          Pagos
        </h2>
        <p className="text-text-secondary leading-relaxed">
          Los pagos de publicaciones destacadas y suscripciones son procesados
          por Mercado Pago.
        </p>
        <p className="text-text-secondary leading-relaxed">
          UMPI no almacena números completos de tarjetas ni credenciales
          bancarias.
        </p>
      </section>

      <section>
        <h2 className="font-header-md text-header-md text-text-deep mb-2">
          Compartición de datos
        </h2>
        <p className="text-text-secondary leading-relaxed">
          Los datos podrán compartirse únicamente con:
        </p>
        <ul className="list-disc pl-5 text-text-secondary leading-relaxed">
          <li>Mercado Pago (para pagos).</li>
          <li>Proveedores tecnológicos.</li>
          <li>Autoridades competentes cuando la ley lo requiera.</li>
        </ul>
        <p className="text-text-secondary leading-relaxed">
          UMPI no vende datos personales.
        </p>
      </section>

      <section>
        <h2 className="font-header-md text-header-md text-text-deep mb-2">
          Seguridad
        </h2>
        <p className="text-text-secondary leading-relaxed">
          UMPI adopta medidas técnicas y organizativas para proteger la
          información contra accesos no autorizados.
        </p>
      </section>

      <section>
        <h2 className="font-header-md text-header-md text-text-deep mb-2">
          Derechos del usuario
        </h2>
        <p className="text-text-secondary leading-relaxed">
          De conformidad con la Ley 25.326, el usuario podrá solicitar:
        </p>
        <ul className="list-disc pl-5 text-text-secondary leading-relaxed">
          <li>Acceso.</li>
          <li>Rectificación.</li>
          <li>Actualización.</li>
          <li>Supresión de sus datos personales.</li>
        </ul>
        <p className="text-text-secondary leading-relaxed">
          Las solicitudes podrán realizarse mediante el correo electrónico
          oficial de soporte de UMPI.
        </p>
      </section>

      <section>
        <h2 className="font-header-md text-header-md text-text-deep mb-2">
          Eliminación de Cuenta y Datos Personales
        </h2>
        <p className="text-text-secondary leading-relaxed">
          En UMPI, los usuarios tienen derecho a solicitar la eliminación
          total de su cuenta y de todos sus datos asociados en cualquier
          momento.
        </p>
        <p className="text-text-secondary leading-relaxed">
          Cómo solicitar la eliminación de tu cuenta:
        </p>
        <p className="text-text-secondary leading-relaxed">
          Desde la Aplicación: Ve a Perfil &gt; Ajustes &gt; Eliminar cuenta.
        </p>
        <p className="text-text-secondary leading-relaxed">
          Por Correo Electrónico: Envía una solicitud de eliminación a
          nuestro equipo de soporte a info@umpi.com.ar desde la dirección
          de correo registrada en tu cuenta de UMPI.
        </p>
        <p className="text-text-secondary leading-relaxed">
          Datos que se eliminan:
        </p>
        <p className="text-text-secondary leading-relaxed">
          Al procesar la solicitud, eliminaremos de forma permanente:
        </p>
        <ul className="list-disc pl-5 text-text-secondary leading-relaxed">
          <li>Tu perfil de usuario (nombre, correo electrónico y datos de contacto).</li>
          <li>Todas tus publicaciones y avisos clasificados subidos.</li>
          <li>Tu historial de chats e imágenes asociadas.</li>
        </ul>
        <p className="text-text-secondary leading-relaxed">
          Retención de datos:
        </p>
        <p className="text-text-secondary leading-relaxed">
          Los datos se eliminan de manera inmediata al confirmar la
          solicitud. Algunos registros técnicos de seguridad se conservarán
          por un período máximo de 30 días únicamente para fines de
          auditoría y prevención de fraudes, tras lo cual serán eliminados
          por completo.
        </p>
      </section>

      <section>
        <h2 className="font-header-md text-header-md text-text-deep mb-2">
          Conservación
        </h2>
        <p className="text-text-secondary leading-relaxed">
          Los datos serán conservados mientras exista la cuenta o durante el
          tiempo necesario para cumplir obligaciones legales.
        </p>
      </section>

      <section>
        <h2 className="font-header-md text-header-md text-text-deep mb-2">
          Cookies
        </h2>
        <p className="text-text-secondary leading-relaxed">
          El sitio web podrá utilizar cookies para mejorar la experiencia del
          usuario y obtener estadísticas de uso.
        </p>
      </section>

      <section>
        <h2 className="font-header-md text-header-md text-text-deep mb-2">
          Menores de edad
        </h2>
        <p className="text-text-secondary leading-relaxed">
          UMPI no está destinada a menores de 18 años sin autorización de sus
          representantes legales.
        </p>
      </section>

      <section>
        <h2 className="font-header-md text-header-md text-text-deep mb-2">
          Actualizaciones
        </h2>
        <p className="text-text-secondary leading-relaxed">
          Esta Política de Privacidad podrá modificarse cuando resulte
          necesario.
        </p>
        <p className="text-text-secondary leading-relaxed">
          La fecha de la última actualización será publicada junto con este
          documento.
        </p>
      </section>
    </LegalPageLayout>
  )
}
